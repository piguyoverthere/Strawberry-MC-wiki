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
    const types = [
        ["page-new", "New pages"],
        ["page-edit", "Page changes"],
        ["news", "News"],
        ["vote", "Approvals"],
        ["idea", "New ideas"],
        ["comment", "Idea comments"],
        ["thread", "Threads & debates"],
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
    function bugHref(title) {
        const id = bugIds.get(title);
        return id ? `bugs.html#${id}` : "bugs.html";
    }
    function ideaHref(title) {
        const id = controversy.ideas.get(title);
        return id ? `ideas.html#${id}` : "ideas.html";
    }
    function discussionHref(title) {
        const id = controversy.discussions.get(title);
        return id ? `discussions.html#${id}` : "discussions.html";
    }

    // Turns a commit message into an update, or null for bookkeeping commits nobody needs to see
    function describe(message) {
        const update = describeLine(message.split("\n")[0].trim().replace(/ \(needs review\)$/, ""));
        if (update && / \(needs review\)$/.test(message.split("\n")[0].trim())) update.needsReview = true;
        return update;
    }

    function describeLine(line) {
        let match;
        if (/^Add .+ to search$|^Rename .+ in search$|^Update review queue for /.test(line)) return null;
        if ((match = line.match(/^([^:]+?) (approves|disapproves) ((?:idea|bug): .+|comment by .+|reply by .+|.+'s vote on idea: .+|(?:a change|all changes) to .+ page|the draft .+ page)$/)))
            return { type: "review", who: match[1], text: ` ${match[2]} `, target: match[3], href: null, vote: match[2] === "approves" ? "approve" : "disapprove" };
        if ((match = line.match(/^([^:]+?) sets role of ([^:]+) to (admin|editor|reviewer)$/))) return { type: "account", who: match[1], text: ` made ${match[2]} ${match[3] === "admin" ? "an admin" : match[3] === "editor" ? "an editor" : "a reviewer"}`, target: "", href: null };
        if ((match = line.match(/^([^:]+?) (blocks [^:]+ until .+|unblocks [^:]+)$/))) return { type: "account", who: match[1], text: ` ${match[2]}`, target: "", href: null };
        if ((match = line.match(/^([^:]+?) sets the review password$/))) return { type: "account", who: match[1], text: " set the review password", target: "", href: null };
        if ((match = line.match(/^Create (.+) page$/))) return { type: "page-new", text: "New page: ", target: match[1], page: true };
        if ((match = line.match(/^Update (.+) page$/))) return { type: "page-edit", text: "Page changed: ", target: match[1], page: true };
        if ((match = line.match(/^Add (.+) to news$/))) return { type: "news", text: "News article: ", target: match[1], href: "news.html" };
        if ((match = line.match(/^(.+?) votes (approve|disapprove) on idea: (.+)$/)))
            return { type: "vote", who: match[1], vote: match[2], text: ` ${match[2] === "approve" ? "approved" : "disapproved"} `, target: match[3], href: ideaHref(match[3]) };
        if ((match = line.match(/^(.+?) adds idea: (.+)$/))) return { type: "idea", who: match[1], text: " added an idea: ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) comments on idea: (.+)$/))) return { type: "comment", who: match[1], text: " commented on ", target: match[2], href: ideaHref(match[2]) };
        if ((match = line.match(/^(.+?) replies in: (.+)$/))) return { type: "thread", who: match[1], text: " replied in ", target: match[2], href: discussionHref(match[2]) };
        if ((match = line.match(/^(.+?) starts (debate|thread): (.+)$/)))
            return { type: "thread", who: match[1], text: ` started a ${match[2]}: `, target: match[3], href: discussionHref(match[3]) };
        if ((match = line.match(/^(.+?) reports bug: (.+)$/))) return { type: "bug", who: match[1], text: " reported a bug: ", target: match[2], href: bugHref(match[2]) };
        if ((match = line.match(/^(.+?) sets bug (status|severity) to (.+?): (.+)$/)))
            return { type: "bug", who: match[1], text: ` set ${match[2]} to ${match[3]} on `, target: match[4], href: bugHref(match[4]) };
        if ((match = line.match(/^(.+?) comments on bug: (.+)$/))) return { type: "bug", who: match[1], text: " commented on bug ", target: match[2], href: bugHref(match[2]) };
        if ((match = line.match(/^Register account: (.+)$/))) return { type: "account", who: match[1], text: " joined the wiki", target: "", href: null };
        return { type: "site", text: "", target: line, href: null };
    }

    const lastSeen = readStorage(seenStorageKey);
    const filters = { type: "all", query: "" };
    const updates = [];
    let page = 1;
    let finished = false;
    let loading = false;

    const status = element("p", { className: "controversy-status", role: "status" });
    const list = element("ol", { className: "notification-list" });
    const more = element("button", { type: "button", className: "wiki-primary-button notification-more", onclick: () => load() }, "Load older updates");
    const toolbar = element("div", { className: "controversy-toolbar" },
        element("label", {}, "Show ",
            element("select", { onchange: (event) => { filters.type = event.target.value; render(); } },
                element("option", { value: "all" }, "All updates"),
                ...types.map(([value, label]) => element("option", { value }, label)))),
        element("input", {
            type: "search", placeholder: "Search updates…", "aria-label": "Search updates",
            oninput: (event) => { filters.query = event.target.value.trim().toLowerCase(); render(); }
        }));
    app.replaceChildren(toolbar, status, list, more);

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
        const shown = grouped.filter((update) =>
            (filters.type === "all" || update.type === filters.type) &&
            (!filters.query || `${update.who || ""} ${update.text} ${update.target}`.toLowerCase().includes(filters.query)));
        list.replaceChildren(...shown.map((update) => {
            // Looked up here rather than when loading, since search.js may load after this script
            const href = update.page ? pageHref(update.target) : update.href;
            return element("li", { className: `notification notification-${update.type}${update.vote ? ` notification-${update.vote}` : ""}${update.isNew ? " notification-new" : ""}` },
                element("span", { className: `idea-badge notification-badge notification-badge-${update.type}` }, typeLabels[update.type]),
                element("span", { className: "notification-text" },
                    update.who ? element("strong", {}, update.who) : null,
                    update.text,
                    href ? element("a", { href }, update.target) : update.target,
                    update.count > 1 ? element("span", { className: "notification-count" }, ` ×${update.count}`) : null,
                    update.needsReview ? element("span", { className: "notification-review-label" }, "Needs review") : null,
                    update.isNew ? element("span", { className: "notification-new-label" }, "New") : null),
                element("time", { className: "notification-time", datetime: update.date }, formatTime(update.date)));
        }));
        if (!shown.length && !loading)
            list.append(element("li", { className: "notification" }, finished ? "No updates match." : "No updates match yet. Load older updates to look further back."));
        more.hidden = finished;
    }

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
    Promise.all([json("controversy.json"), json("bugs.json")]).then(([ideas, bugs]) => {
        if (ideas) {
            controversy = {
                ideas: new Map((ideas.ideas || []).map((idea) => [idea.title, idea.id])),
                discussions: new Map((ideas.discussions || []).map((discussion) => [discussion.title, discussion.id]))
            };
        }
        if (bugs) {
            bugIds = new Map((bugs.bugs || []).map((bug) => [bug.title, bug.id]));
        }
    }).finally(() => load());
})();
