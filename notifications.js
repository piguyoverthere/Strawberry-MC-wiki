(() => {
    const app = document.querySelector("#notifications-app");
    if (!app) {
        return;
    }

    // Every change to the wiki is saved as a commit, so the commit history is the list of updates.
    const repository = { owner: "piguyoverthere", name: "Strawberry-MC-wiki", branch: "main" };
    const perPage = 100;
    const seenStorageKey = "strawberry-wiki-notifications-seen";
    const tokenStorageKey = "strawberry-wiki-github-token";
    const pagePath = decodeURIComponent(location.pathname);
    const bookmarkStorageKey = `strawberry-wiki-bookmarks:${pagePath.slice(0, pagePath.lastIndexOf("/") + 1)}`;
    const types = [
        ["page-new", "New pages"],
        ["page-edit", "Page changes"],
        ["news", "News"],
        ["vote", "Approvals"],
        ["idea", "New ideas"],
        ["comment", "Idea comments"],
        ["thread", "Threads & debates"],
        ["annotation", "Page comments"],
        ["bug", "Bugs"],
        ["review", "Reviews"],
        ["account", "Accounts"],
        ["site", "Site updates"]
    ];
    const typeLabels = Object.fromEntries(types);
    // Pages whose title in commit messages differs from their title in search
    const specialPages = { "Threads & Debates (Village Pump)": "discussions.html" };

    function element(tag, options = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(options)) {
            if (key === "className") node.className = value;
            else if (key === "text") node.textContent = value;
            else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
            else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
        }
        node.append(...children.filter((child) => child !== null && child !== undefined));
        return node;
    }

    function readStorage(key) {
        try {
            return localStorage.getItem(key) || "";
        } catch {
            return "";
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // Without storage every update just shows as not new.
        }
    }

    function pageHref(title) {
        if (specialPages[title]) return specialPages[title];
        const index = typeof pages !== "undefined" && Array.isArray(pages) ? pages : [];
        const plain = title.replace(/\s*\([^)]*\)\s*$/, "");
        // Pages that were merged away or deleted aren't in search, so they aren't linked
        const match = index.find((page) => page.title === title) || index.find((page) => page.title === plain);
        return match ? match.href : null;
    }

    // Ideas and threads are linked by id, looked up from their title
    let controversy = { ideas: new Map(), discussions: new Map() };
    let bugIds = new Map();
    let bugsByTitle = new Map();
    // Account keys of the people you follow, from your profile
    let following = new Set();
    function bugHref(title) {
        const id = bugIds.get(title);
        return id ? `bugs.html#${id}` : "bugs.html";
    }
    function ideaHref(title) {
        const idea = controversy.ideas.get(title);
        return idea ? `${idea.archived ? "archives" : "ideas"}.html#${idea.id}` : "ideas.html";
    }
    function discussionHref(title) {
        const discussion = controversy.discussions.get(title);
        return discussion ? `${discussion.archived ? "archives" : "discussions"}.html#${discussion.id}` : "discussions.html";
    }

    // Turns a commit message into an update, or null for bookkeeping commits nobody needs to see
    function describe(message) {
        const update = describeLine(message.split("\n")[0].trim().replace(/ \(needs review\)$/, ""));
        if (update && / \(needs review\)$/.test(message.split("\n")[0].trim())) update.needsReview = true;
        // Page saves name who made them on a line of their own
        const editor = message.match(/^Edited-by: (.+)$/m);
        if (update && editor && !update.who && update.page) {
            update.who = editor[1].trim();
            update.text = update.type === "page-new" ? " created a page: " : " changed ";
        }
        return update;
    }

    function describeLine(line) {
        let match;
        if (/^Remove answered restore request for |^Remove answered appeal of |^Editing status: |^Add .+ to search$|^Rename .+ in search$|^Update review queue for |^Remove unresolved notes from .+ page$|^Add unresolved note to .+ page$/.test(line)) return null;
        if ((match = line.match(/^([^:]+?) (approves|disapproves) ((?:idea|bug): .+|all waiting changes in .+|comment by .+|reply by .+|.+'s vote on idea: .+|(?:a change|all changes) to .+ page|the draft .+ page)$/)))
            return { type: "review", who: match[1], text: ` ${match[2]} `, target: match[3], href: null, vote: match[2] === "approves" ? "approve" : "disapprove" };
        if ((match = line.match(/^([^:]+?) sets role of ([^:]+) to (admin|editor|reviewer)$/))) return { type: "account", who: match[1], text: ` made ${match[2]} ${match[3] === "admin" ? "an admin" : match[3] === "editor" ? "an editor" : "a reviewer"}`, target: "", href: null };
        if ((match = line.match(/^([^:]+?) (bans [^:]+ until .+|changes the ban of [^:]+|unbans [^:]+|puts a restraining order on [^:]+ until .+|changes the restraining order on [^:]+|lifts the restraining order on [^:]+)$/))) return { type: "account", who: match[1], text: ` ${match[2]}`, target: "", href: null };
        if ((match = line.match(/^([^:]+?) (blocks [^:]+ until .+|unblocks [^:]+)$/))) return { type: "account", who: match[1], text: ` ${match[2]}`, target: "", href: null };
        if (/^.+ confirms an email address$|^Reset personal password: |^.+ changes their personal password$/.test(line)) return null;
        if (/^.+ (unfollows .+|changes their settings|changes their privacy settings|adds a profile picture|removes a profile picture|removes a picture from their profile)$/.test(line)) return null;
        if ((match = line.match(/^([^:]+?) follows ([^:]+)$/))) return { type: "account", who: match[1], text: " started following ", target: match[2], href: `profile.html?${new URLSearchParams({ u: match[2] })}`, assigned: [match[2]] };
        if ((match = line.match(/^([^:]+?) (updates their profile|adds a picture to their profile|changes their profile picture)$/)))
            return { type: "account", who: match[1], text: ` ${{ "updates their profile": "updated their profile", "adds a picture to their profile": "added a picture to their profile", "changes their profile picture": "changed their profile picture" }[match[2]]}`, target: "", href: `profile.html?${new URLSearchParams({ u: match[1] })}` };
        if ((match = line.match(/^([^:]+?) changes the wiki password$/))) return { type: "account", who: match[1], text: " changed the wiki password", target: "", href: null };
        if ((match = line.match(/^([^:]+?) sets up email for password recovery$/))) return { type: "account", who: match[1], text: " set up email for password recovery", target: "", href: null };
        if ((match = line.match(/^([^:]+?) asks an admin to reset their password$/))) return { type: "account", who: match[1], text: " asked an admin to reset their password", target: "", href: "admin.html" };
        if ((match = line.match(/^([^:]+?) resets the password of: (.+)$/))) return { type: "account", who: match[1], text: ` reset the password of ${match[2]}`, target: "", href: null };
        if ((match = line.match(/^([^:]+?) sets the review password$/))) return { type: "account", who: match[1], text: " set the review password", target: "", href: null };
        if ((match = line.match(/^(.+?) restores (.+) page to the version from (.+?)(?: for (.+))?$/)))
            return { type: "page-edit", who: match[1], text: ` restored an older version (${match[3]}) of `, target: match[2], page: true, assigned: match[4] ? [match[4]] : undefined };
        if ((match = line.match(/^([^:]+?) appeals their (ban|restraining order)$/)))
            return { type: "review", who: match[1], text: ` appealed their ${match[2]}`, target: "", href: "admin.html", restoreRequest: true };
        if ((match = line.match(/^([^:]+?) (warns [^:]+|lifts the (?:ban|restraining order) on [^:]+ after an appeal|turns down the appeal of [^:]+)$/)))
            return { type: "account", who: match[1], text: ` ${match[2]}`, target: "", href: null };
        if ((match = line.match(/^(.+?) asks to restore (.+) page to the version from (.+)$/)))
            return { type: "review", who: match[1], text: ` asked to restore an older version (${match[3]}) of `, target: match[2], href: null, page: true, restoreRequest: true };
        if ((match = line.match(/^(.+?) declines restoring (.+) page for (.+)$/)))
            return { type: "review", who: match[1], text: ` turned down ${match[3]}'s request to restore `, target: match[2], page: true, assigned: [match[3]] };
        if ((match = line.match(/^(.+?) changes the search keywords of (.+) page$/)))
            return { type: "page-edit", who: match[1], text: " changed the search keywords of ", target: match[2], page: true };
        if ((match = line.match(/^Create (.+) page$/))) return { type: "page-new", text: "New page: ", target: match[1], page: true };
        if ((match = line.match(/^Update (.+) page$/))) return { type: "page-edit", text: "Page changed: ", target: match[1], page: true };
        if ((match = line.match(/^Add (.+) to news$/))) return { type: "news", text: "News article: ", target: match[1], href: "news.html" };
        if ((match = line.match(/^(.+?) votes (approve|disapprove|convince) on idea: (.+)$/)))
            return { type: "vote", who: match[1], vote: match[2], text: ` ${{ approve: "approved", disapprove: "disapproved", convince: "said this needs convincing:" }[match[2]]} `, target: match[3], href: ideaHref(match[3]) };
        if ((match = line.match(/^(.+?) adds idea: (.+)$/))) return { type: "idea", who: match[1], text: " added an idea: ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) pings (.+) on idea: (.+)$/))) return { type: "comment", who: match[1], text: ` pinged ${match[2]} in a comment on `, target: match[3], href: ideaHref(match[3]), assigned: match[2].split(", ") };
        if ((match = line.match(/^(.+?) comments on idea: (.+)$/))) return { type: "comment", who: match[1], text: " commented on ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) replies in: (.+)$/))) return { type: "thread", who: match[1], text: " replied in ", target: match[2], href: discussionHref(match[2]) };
        if ((match = line.match(/^(.+?) starts (debate|thread): (.+)$/)))
            return { type: "thread", who: match[1], text: ` started a ${match[2]}: `, target: match[3], href: discussionHref(match[3]) };
        if ((match = line.match(/^(.+?) edits idea: (.+)$/))) return { type: "idea", who: match[1], text: " edited an idea: ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) marks idea completed: (.+)$/))) return { type: "idea", who: match[1], text: " marked an idea as completed: ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) moves idea back from completed: (.+)$/))) return { type: "idea", who: match[1], text: " moved an idea back from Completed: ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) (archives|restores) idea: (.+)$/))) return { type: "idea", who: match[1], text: match[2] === "archives" ? " moved to Archives: " : " restored an idea: ", target: match[3], href: "archives.html" };
        if ((match = line.match(/^(.+?) marks (.+) as unresolved$/))) return { type: "page-edit", who: match[1], text: " marked as unresolved: ", target: match[2], page: true };
        if ((match = line.match(/^(.+?) resolves page: (.+)$/))) return { type: "page-edit", who: match[1], text: " resolved ", target: match[2], page: true };
        if ((match = line.match(/^(.+?) assigns (.+) on page: (.+)$/))) return { type: "annotation", who: match[1], text: ` assigned ${match[2]} a priority task on `, target: match[3], page: true, assigned: match[2].split(", ") };
        if ((match = line.match(/^(.+?) comments on page: (.+)$/))) return { type: "annotation", who: match[1], text: " commented on ", target: match[2], page: true };
        if ((match = line.match(/^(.+?) deletes a comment on page: (.+)$/))) return { type: "annotation", who: match[1], text: " deleted a comment on ", target: match[2], page: true };
        if (/^.+ finishes a task from ann-/.test(line)) return null;
        if ((match = line.match(/^(.+?) uploads (a new|an older) version of (.+)$/))) return { type: "site", who: match[1], text: ` uploaded ${match[2]} version of `, target: match[3], href: "documents.html" };
        if (/^.+ records the date of a version of /.test(line)) return null;
        if ((match = line.match(/^(.+?) sets a version date of (.+)$/))) return { type: "site", who: match[1], text: " changed a version date of ", target: match[2], href: "documents.html" };
        if ((match = line.match(/^(.+?) reports bug: (.+)$/))) return { type: "bug", who: match[1], text: " reported a bug: ", target: match[2], href: bugHref(match[2]) };
        if ((match = line.match(/^(.+?) sets bug (status|severity) to (.+?): (.+)$/)))
            return { type: "bug", who: match[1], text: ` set ${match[2]} to ${match[3]} on `, target: match[4], href: bugHref(match[4]) };
        if ((match = line.match(/^(.+?) comments on bug: (.+)$/))) return { type: "bug", who: match[1], text: " commented on bug ", target: match[2], href: bugHref(match[2]) };
        if ((match = line.match(/^Register account: (.+)$/))) return { type: "account", who: match[1], text: " joined the wiki", target: "", href: null };
        return { type: "site", text: "", target: line, href: null };
    }

    function isForMe(update) {
        const store = window.wikiStore;
        if (!update.assigned || update.needsReview || !store?.isSignedIn()) return false;
        const me = store.getAuthor().trim().toLowerCase();
        return update.assigned.some((name) => name.trim().toLowerCase() === me);
    }

    function readBookmarkedPages() {
        try {
            const pages = JSON.parse(readStorage(bookmarkStorageKey) || "[]");
            return new Set(Array.isArray(pages) ? pages.map((page) => page?.href) : []);
        } catch {
            return new Set();
        }
    }

    const same = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();

    // Why an update belongs on your Notifications tab, or "" if it only belongs under Changes
    function reasonFor(update) {
        const store = window.wikiStore;
        if (!store?.isSignedIn()) return "";
        const me = store.getAuthor();
        if (same(update.who, me)) return "";
        if (isForMe(update)) return "⚑ For you";
        // Admins see requests to restore a page and appeals
        if (update.restoreRequest && store.isAdmin()) return "Needs an admin";
        if (["vote", "idea", "comment", "review"].includes(update.type)) {
            const idea = controversy.ideas.get(update.target.replace(/^idea: /, ""));
            if (idea) {
                if (same(idea.author, me)) return "Your idea";
                if (update.type === "comment" && ((idea.replies || []).some((reply) => same(reply.author, me)) ||
                    (idea.comments || []).some((comment) => same(String(comment).split(":")[0], me)))) return "You commented";
            }
        }
        if (update.type === "thread") {
            const discussion = controversy.discussions.get(update.target);
            if (discussion && same(discussion.author, me)) return "Your thread";
            if (discussion && (discussion.posts || []).some((post) => same(post.author, me))) return "You replied";
        }
        if (update.type === "bug") {
            const bug = bugsByTitle.get(update.target);
            if (bug && same(bug.reporter, me)) return "Your bug";
            if (bug && (bug.comments || []).some((comment) => same(comment.author, me))) return "You commented";
        }
        if (update.page && readBookmarkedPages().has(pageHref(update.target))) return "★ Bookmarked page";
        if (update.who && following.has(update.who.trim().toLowerCase())) return "Following";
        return "";
    }

    // Priority tasks: comments on articles that named you with @
    const tasksSection = element("section", { className: "notification-tasks", hidden: true });

    function renderTasks(data) {
        const store = window.wikiStore;
        const tasks = store?.isSignedIn() ? store.annotationTasks(data, store.getAuthor()) : [];
        tasksSection.hidden = !tasks.length;
        tasksSection.replaceChildren(element("h2", {}, `⚑ Priority tasks for you (${tasks.length})`),
            ...tasks.map(({ annotation, item }) => element("article", { className: "notification-task" },
                element("div", {},
                    element("strong", {}, item.author),
                    " on ",
                    element("a", { href: `${annotation.page}#${annotation.id}` }, annotation.pageTitle),
                    element("span", { className: "notification-time" }, ` · ${formatTime(item.date)}`)),
                element("blockquote", { className: "wiki-annotation-quote" }, annotation.quote),
                element("p", {}, item.text),
                element("button", {
                    type: "button", className: "wiki-review-approve",
                    onclick: (event) => {
                        event.target.disabled = true;
                        store.markTaskDone(annotation.id, item.id).then(renderTasks).catch((error) => {
                            event.target.disabled = false;
                            status.textContent = `Could not save: ${error.message}`;
                        });
                    }
                }, "Mark done"))));
    }

    fetch("annotations.json", { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}).then((data) => {
        renderTasks(data);
        if (window.wikiStore?.isSignedIn()) window.wikiStore.watchJson("annotations.json", renderTasks);
    }).catch(() => {});

    const lastSeen = readStorage(seenStorageKey);
    // Notifications are the updates that concern you; Changes is everything. Your settings pick which opens first.
    const signedIn = Boolean(window.wikiStore?.isSignedIn());
    const startTab = location.hash === "#changes" || location.hash === "#notifications"
        ? location.hash.slice(1)
        : signedIn && !["all", "changes"].includes(window.wikiStore.readLook().notificationsView) ? "notifications" : "changes";
    const filters = { tab: startTab, type: "all", query: "" };
    const updates = [];
    const seenCommits = new Set();
    let page = 1;
    let finished = false;
    let loading = false;

    const status = element("p", { className: "controversy-status", role: "status" });
    const list = element("ol", { className: "notification-list" });
    const more = element("button", { type: "button", className: "wiki-primary-button notification-more", onclick: () => load() }, "Load older updates");
    const typeFilter = element("label", {}, "Show ",
        element("select", { onchange: (event) => { filters.type = event.target.value; render(); } },
            element("option", { value: "all" }, "All changes"),
            ...types.map(([value, label]) => element("option", { value }, label))));
    const toolbar = element("div", { className: "controversy-toolbar" },
        typeFilter,
        element("input", {
            type: "search", placeholder: "Search updates…", "aria-label": "Search updates",
            oninput: (event) => { filters.query = event.target.value.trim().toLowerCase(); render(); }
        }));
    const tabButtons = Object.fromEntries([["notifications", "Notifications"], ["changes", "Changes"]].map(([value, label]) =>
        [value, element("button", { type: "button", role: "tab", className: "notification-tab", onclick: () => showTab(value) }, label)]));
    const tabBar = element("div", { className: "notification-tabs", role: "tablist", "aria-label": "Notifications or all changes" }, ...Object.values(tabButtons));
    const tabHint = element("p", { className: "notification-tab-hint" });
    const signInNote = element("p", { className: "notification-sign-in" },
        element("a", { href: window.wikiStore?.loginHref() || "login.html" }, "Log in"),
        " to see notifications about your ideas, threads, comments, bookmarked pages and the people you follow. Everything else is under Changes.");
    // Your own edits that are saved in this browser but not committed to the wiki yet
    const draftsSection = element("section", { className: "notification-drafts" });
    function renderDrafts() {
        const drafts = window.wikiStore?.uncommittedEdits?.() || [];
        draftsSection.hidden = !drafts.length || filters.tab !== "notifications";
        draftsSection.replaceChildren(
            element("h2", {}, `Your uncommitted edits (${drafts.length})`),
            element("p", { className: "notification-tab-hint" }, "Saved in this browser only. Nobody else can see them until you open the page and commit them to GitHub."),
            element("ul", {}, ...drafts.map((draft) => element("li", {},
                element("a", { href: draft.href }, draft.title),
                draft.saved ? element("span", { className: "idea-meta" }, ` saved ${formatTime(draft.saved)}`) : null,
                draft.isNew ? element("span", { className: "idea-meta" }, " · new page") : null))));
    }
    app.replaceChildren(tabBar, tabHint, draftsSection, tasksSection, toolbar, status, list, more);

    function showTab(tab) {
        filters.tab = tab;
        history.replaceState(null, "", `#${tab}`);
        render();
    }

    function formatTime(value) {
        const date = new Date(value);
        return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    }

    function render() {
        // The same change saved several times in a row shows once, with a count
        const grouped = [];
        for (const update of updates) {
            const previous = grouped[grouped.length - 1];
            if (previous && previous.message === update.message && previous.date.slice(0, 10) === update.date.slice(0, 10)) {
                previous.count++;
                previous.isNew = previous.isNew || update.isNew;
            } else {
                grouped.push({ ...update, count: 1 });
            }
        }
        for (const update of grouped) update.reason = reasonFor(update);
        const onNotifications = filters.tab === "notifications";
        for (const [value, button] of Object.entries(tabButtons)) {
            const fresh = grouped.filter((update) => update.isNew && (value === "changes" || update.reason)).length;
            button.setAttribute("aria-selected", String(value === filters.tab));
            button.replaceChildren(value === "notifications" ? "Notifications" : "Changes",
                ...(fresh ? [element("span", { className: "notification-tab-count" }, String(fresh))] : []));
        }
        tabHint.textContent = onNotifications
            ? "Replies and votes on your ideas, threads and comments you're part of, changes to your bookmarked pages, what the people you follow do, and anything that names you."
            : "Everything that has changed on the wiki: new pages, page edits, votes, ideas, comments and replies.";
        typeFilter.hidden = onNotifications;
        renderDrafts();
        tasksSection.classList.toggle("notification-tasks-off", !onNotifications);
        if (onNotifications && !signedIn) {
            list.replaceChildren(element("li", { className: "notification" }, signInNote));
            more.hidden = true;
            return;
        }
        const shown = grouped.filter((update) =>
            (onNotifications ? update.reason : filters.type === "all" || update.type === filters.type) &&
            (!filters.query || `${update.who || ""} ${update.text} ${update.target}`.toLowerCase().includes(filters.query)));
        list.replaceChildren(...shown.map((update) => {
            // Looked up here rather than when loading, since search.js may load after this script
            const pageLink = update.page ? pageHref(update.target) : null;
            const href = update.restoreRequest && pageLink ? `${pageLink}#wiki-history` : update.page ? pageLink : update.href;
            return element("li", { className: `notification notification-${update.type}${update.vote ? ` notification-${update.vote}` : ""}${update.isNew ? " notification-new" : ""}${isForMe(update) ? " notification-priority" : ""}` },
                element("span", { className: `idea-badge notification-badge notification-badge-${update.type}` }, typeLabels[update.type]),
                element("span", { className: "notification-text" },
                    update.who ? element("strong", {}, element("a", { className: "notification-who", href: `profile.html?${new URLSearchParams({ u: update.who })}` }, update.who)) : null,
                    update.text,
                    href ? element("a", { href }, update.target) : update.target,
                    update.count > 1 ? element("span", { className: "notification-count" }, ` ×${update.count}`) : null,
                    update.needsReview ? element("span", { className: "notification-review-label" }, "Needs review") : null,
                    onNotifications && update.reason && update.reason !== "⚑ For you" ? element("span", { className: "notification-reason" }, update.reason) : null,
                    isForMe(update) ? element("span", { className: "notification-priority-label" }, "⚑ For you") : null,
                    update.isNew ? element("span", { className: "notification-new-label" }, "New") : null),
                element("time", { className: "notification-time", datetime: update.date }, formatTime(update.date)));
        }));
        if (!shown.length && !loading)
            list.append(element("li", { className: "notification" }, finished
                ? onNotifications ? "No notifications yet." : "No updates match."
                : onNotifications ? "No notifications yet. Load older updates to look further back." : "No updates match yet. Load older updates to look further back."));
        more.hidden = finished;
    }

    // New updates appear at the top while the page is open. An unchanged list answers 304, which doesn't use up GitHub's limit.
    let feedTag = "";

    async function refreshFeed() {
        let token = readStorage(tokenStorageKey);
        try {
            token = sessionStorage.getItem(tokenStorageKey) || token;
        } catch {
            // Storage blocked; use what was found.
        }
        if (document.hidden || loading || !token || !updates.length) return;
        try {
            const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/commits?sha=${repository.branch}&per_page=30`, {
                cache: "no-store",
                headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(feedTag ? { "If-None-Match": feedTag } : {}) }
            });
            if (!response.ok) return;
            feedTag = response.headers.get("ETag") || "";
            const fresh = [];
            for (const commit of await response.json()) {
                if (seenCommits.has(commit.sha)) continue;
                seenCommits.add(commit.sha);
                const update = describe(commit.commit.message);
                if (!update) continue;
                const date = commit.commit.committer?.date || commit.commit.author?.date;
                fresh.push({ ...update, message: commit.commit.message.split("\n")[0], date, isNew: true });
                writeStorage(seenStorageKey, date > readStorage(seenStorageKey) ? date : readStorage(seenStorageKey));
            }
            if (fresh.length) {
                updates.unshift(...fresh);
                render();
            }
        } catch {
            // The connection dropped for a moment; the next check tries again.
        }
    }

    setInterval(refreshFeed, 6000);

    async function load() {
        if (loading || finished) return;
        loading = true;
        more.disabled = true;
        status.textContent = "Loading updates…";
        try {
            const token = readStorage(tokenStorageKey);
            const response = await fetch(
                `https://api.github.com/repos/${repository.owner}/${repository.name}/commits?sha=${repository.branch}&per_page=${perPage}&page=${page}`,
                { headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
            if (response.status === 403 || response.status === 429)
                throw new Error("GitHub is limiting how often updates can be loaded. Try again in a few minutes.");
            if (!response.ok)
                throw new Error(`Could not load updates (${response.status}).`);
            const commits = await response.json();
            for (const commit of commits) {
                const update = describe(commit.commit.message);
                if (!update) continue;
                const date = commit.commit.committer?.date || commit.commit.author?.date;
                seenCommits.add(commit.sha);
                updates.push({ ...update, message: commit.commit.message.split("\n")[0], date, isNew: Boolean(lastSeen) && date > lastSeen });
            }
            if (page === 1 && commits.length) {
                const newest = commits[0].commit.committer?.date || "";
                if (newest) writeStorage(seenStorageKey, newest);
                const fresh = updates.filter((update) => update.isNew).length;
                status.textContent = !lastSeen ? "" : fresh ? `${fresh} new update${fresh === 1 ? "" : "s"} since your last visit.` : "No new updates since your last visit.";
            } else {
                status.textContent = "";
            }
            finished = commits.length < perPage;
            page++;
        } catch (error) {
            status.textContent = error.message;
        } finally {
            loading = false;
            more.disabled = false;
            render();
        }
    }

    // Page links need search.js, which wiki-editor.js adds once the page has loaded
    window.addEventListener("load", () => { if (updates.length) render(); }, { once: true });

    // Load the idea, thread and bug ids first so their links go straight to them
    const json = (file) => fetch(file, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null);
    Promise.all([json("controversy.json"), json("bugs.json"), json("profiles.json")]).then(([ideas, bugs, profiles]) => {
        if (ideas) {
            controversy = {
                ideas: new Map((ideas.ideas || []).flatMap((idea) => [idea.title, ...(idea.formerTitles || [])].map((title) => [title, idea]))),
                discussions: new Map((ideas.discussions || []).map((discussion) => [discussion.title, discussion]))
            };
        }
        if (bugs) {
            bugIds = new Map((bugs.bugs || []).map((bug) => [bug.title, bug.id]));
            bugsByTitle = new Map((bugs.bugs || []).map((bug) => [bug.title, bug]));
        }
        const me = window.wikiStore?.isSignedIn() ? window.wikiStore.getAuthor().trim().toLowerCase() : "";
        following = new Set(profiles?.profiles?.[me]?.following || []);
    }).finally(() => load());
})();
