// Ideas and Threads & Debates pages, backed by controversy.json in the repository.
// Reading is open to everyone; voting, adding ideas and posting need your name and the wiki password.
(() => {
    const dataFile = "controversy.json";
    const ideasApp = document.querySelector("#ideas-app");
    const discussionsApp = document.querySelector("#discussions-app");
    const archivesApp = document.querySelector("#archives-app");
    const app = ideasApp || discussionsApp || archivesApp;
    if (!app) {
        return;
    }

    let data = { ideas: [], discussions: [] };
    // Ideas opened with "Show more" stay open when someone else's post redraws the list
    const expandedIdeas = new Set();

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

    function formatDate(value) {
        if (!value) return "";
        const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
        return Number.isNaN(parsed.getTime())
            ? value
            : parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    // Things copied from the document have no time of their own; this is when it was synced.
    const documentSynced = "2026-11-05";

    // A <time> element: date and time for things posted on the site, date only for plain dates.
    function timestamp(value, prefix = "") {
        const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
        if (Number.isNaN(parsed.getTime())) {
            return element("span", { text: `${prefix}${value}` });
        }
        const day = parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        const text = value.length === 10
            ? day
            : `${day}, ${parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        return element("time", {
            className: "controversy-time",
            datetime: value,
            title: value.length === 10 ? formatDate(value) : parsed.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }),
            text: `${prefix}${text}`
        });
    }

    function fromDocument() {
        return element("span", { className: "controversy-time", title: `Copied from the MC Controversy Resolver, synced ${formatDate(documentSynced)}`, text: "from the document" });
    }

    function newId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function nameKey(name) {
        return name.trim().toLowerCase();
    }

    // Text with "- " lines becomes paragraphs and a bullet list.
    function renderText(text) {
        const fragment = document.createDocumentFragment();
        let list = null;
        for (const line of String(text || "").split("\n")) {
            if (!line.trim()) {
                list = null;
                continue;
            }
            if (/^\s*-\s+/.test(line)) {
                if (!list) {
                    list = element("ul");
                    fragment.append(list);
                }
                list.append(element("li", { text: line.replace(/^\s*-\s+/, "") }));
            } else {
                list = null;
                fragment.append(element("p", { text: line }));
            }
        }
        return fragment;
    }

    async function loadData() {
        const response = await fetch(dataFile, { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`Could not load ${dataFile} (${response.status}).`);
        }
        data = await response.json();
        data.ideas = data.ideas || [];
        data.discussions = data.discussions || [];
    }

    // Signing in happens on the login page (username, wiki password and personal password).
    function signedIn() {
        return Boolean(window.wikiStore?.isSignedIn());
    }

    function isAdmin() {
        return Boolean(window.wikiStore?.isAdmin());
    }

    function isReviewer() {
        return Boolean(window.wikiStore?.isReviewer());
    }

    // Reviewers' ideas, comments and replies wait for an admin or editor before they count
    const pendingMark = (role) => role === "reviewer" ? { pending: true } : {};

    function canReview() {
        return Boolean(window.wikiStore?.canReview());
    }

    // A red "Needs review" line; admins and editors also get Approve and Disapprove
    function reviewBar(text, onApprove, onDisapprove) {
        return element("div", { className: "wiki-review-bar" },
            element("span", { text: `Needs review · ${text}` }),
            canReview() ? element("button", { type: "button", className: "wiki-review-approve", text: "Approve", onclick: onApprove }) : null,
            canReview() ? element("button", { type: "button", className: "wiki-review-disapprove", text: "Disapprove", onclick: onDisapprove }) : null);
    }

    // An admin or editor approving or disapproving a reviewer's change. change(fresh) returns false when it's no longer waiting.
    function moderate(approve, what, change) {
        requireSignIn("", (name) => save((fresh) => {
            if (change(fresh) === false) throw new Error("That change is no longer waiting for review. Reload the page.");
        }, `${name} ${approve ? "approves" : "disapproves"} ${what}`)
            .then(() => { status.textContent = approve ? "Approved." : "Disapproved and removed."; }));
    }

    const sameEntry = (item) => (other) => other.author === item.author && other.date === item.date;

    // Runs action(name) straight away when signed in; otherwise goes to the login page and back.
    function requireSignIn(reason, action) {
        const store = window.wikiStore;
        if (!store) {
            alert("The wiki editor did not load, so changes cannot be saved right now.");
            return;
        }
        if (!signedIn()) {
            location.href = store.loginHref();
            return;
        }
        status.textContent = "Saving…";
        action(store.getAuthor()).catch((error) => {
            status.textContent = `Could not save: ${error.message}`;
            renderAccount();
        });
    }

    // "Signed in as Sai · Sign out"
    const account = element("p", { className: "controversy-account" });
    function renderAccount() {
        const store = window.wikiStore;
        if (!store) return;
        if (signedIn()) {
            account.replaceChildren(
                "Signed in as ", element("strong", { text: store.getAuthor() }), " · ",
                element("button", {
                    type: "button", className: "wiki-link-button", text: "Sign out",
                    onclick: () => {
                        store.signOut();
                        location.reload();
                    }
                }));
        } else {
            account.replaceChildren(
                element("a", { href: store.loginHref() }, "Log in or register"),
                " to vote, comment and post.");
        }
    }

    // Commit a change to controversy.json and show the saved result straight away
    // (the live site takes a minute to publish it).
    async function save(change, message, options) {
        data = await window.wikiStore.updateJson(dataFile, change, message, options);
        data.ideas = data.ideas || [];
        data.discussions = data.discussions || [];
        render();
    }

    // Form dialog for adding an idea or starting a discussion ------------------------------------
    function openFormDialog({ title, fields, submitLabel, onSubmit }) {
        const dialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true });
        const form = element("form", { method: "dialog" });
        form.append(element("h2", { text: title }));
        const inputs = {};
        for (const field of fields) {
            const id = `controversy-field-${field.name}`;
            form.append(element("label", { for: id, text: field.label }));
            let input;
            if (field.type === "select") {
                input = element("select", { id });
                for (const [value, label] of field.options) input.append(element("option", { value, text: label }));
            } else if (field.type === "textarea") {
                input = element("textarea", { id, rows: field.rows || 6, required: field.required, maxlength: 8000 });
            } else {
                input = element("input", { id, type: "text", required: field.required, maxlength: 120 });
            }
            inputs[field.name] = input;
            form.append(input);
            if (field.hint) form.append(element("p", { className: "wiki-dialog-hint", text: field.hint }));
        }
        const actions = element("div", { className: "wiki-dialog-actions" },
            element("button", { type: "button", text: "Cancel", onclick: () => dialog.close() }),
            element("button", { type: "submit", className: "wiki-primary", text: submitLabel }));
        form.append(actions);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
            dialog.close();
            onSubmit(values);
        });
        dialog.append(form);
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
        Object.values(inputs)[0]?.focus();
    }

    const status = element("p", { className: "controversy-status", role: "status", "aria-live": "polite" });

    // Ideas page ----------------------------------------------------------------------------------
    const ideaFilters = { author: "", query: "", sort: "document" };

    function voteCounts(idea) {
        const votes = Object.values(idea.votes || {});
        return {
            approve: votes.filter((vote) => vote.vote === "approve"),
            disapprove: votes.filter((vote) => vote.vote === "disapprove")
        };
    }

    function vote(idea, choice) {
        requireSignIn(`${choice === "approve" ? "Approve" : "Disapprove"} "${idea.title}". Voting the same way again removes your vote.`, (name) =>
            save((fresh) => {
                const target = (fresh.ideas || []).find((item) => item.id === idea.id);
                if (!target) throw new Error("This idea no longer exists. Reload the page.");
                target.votes = target.votes || {};
                const key = nameKey(name);
                if (target.votes[key]?.vote === choice) {
                    delete target.votes[key];
                } else {
                    target.votes[key] = { name, vote: choice, date: new Date().toISOString() };
                }
            }, `${name} votes ${choice} on idea: ${idea.title}`, { needsReview: false })
                .then(() => { status.textContent = `Your vote on "${idea.title}" was saved.`; }));
    }

    // The person who posted an idea and admins can move it to the Archives page, and bring it back
    function canDelete(idea) {
        return signedIn() && (isAdmin() || nameKey(idea.author || "") === nameKey(window.wikiStore.getAuthor()));
    }

    function setArchived(idea, archived) {
        if (archived && !window.confirm(`Delete "${idea.title}"? It moves to the Archives page and can be restored from there.`)) return;
        requireSignIn("", (name) => save((fresh) => {
            const target = (fresh.ideas || []).find((item) => item.id === idea.id);
            if (!target) throw new Error("This idea no longer exists. Reload the page.");
            if (archived) {
                target.archived = true;
                target.archivedBy = name;
                target.archivedDate = new Date().toISOString();
            } else {
                delete target.archived;
                delete target.archivedBy;
                delete target.archivedDate;
            }
        }, `${name} ${archived ? "archives" : "restores"} idea: ${idea.title}`, { needsReview: false })
            .then(() => { status.textContent = archived ? "Moved to Archives." : "Restored to the Ideas page."; }));
    }

    function comment(idea, text) {
        requireSignIn(`Comment on "${idea.title}".`, (name) =>
            save((fresh, role) => {
                const target = (fresh.ideas || []).find((item) => item.id === idea.id);
                if (!target) throw new Error("This idea no longer exists. Reload the page.");
                target.replies = target.replies || [];
                target.replies.push({ author: name, text, date: new Date().toISOString(), ...pendingMark(role) });
            }, `${name} comments on idea: ${idea.title}`)
                .then(() => { status.textContent = "Your comment was posted."; }));
    }

    function addIdea() {
        if (!signedIn()) {
            location.href = window.wikiStore.loginHref();
            return;
        }
        openFormDialog({
            title: "Add an idea",
            submitLabel: "Save",
            fields: [
                { name: "title", label: "Idea name", required: true },
                { name: "description", label: "Details", type: "textarea", rows: 8, hint: "Start a line with \"- \" to make a bullet point." }
            ],
            onSubmit: (values) => requireSignIn(`Add the idea "${values.title}" under your name.`, (name) =>
                save((fresh, role) => {
                    fresh.ideas = fresh.ideas || [];
                    fresh.ideas.push({
                        id: newId("idea"), author: name, title: values.title, description: values.description,
                        comments: [], status: "", source: "site", created: new Date().toISOString(), votes: {}, ...pendingMark(role)
                    });
                }, `${name} adds idea: ${values.title}`)
                    .then(() => {
                        ideaFilters.author = "";
                        ideaFilters.sort = "newest";
                        render();
                        status.textContent = `Your idea "${values.title}" was added.`;
                    }))
        });
    }

    function renderIdea(idea) {
        const { approve, disapprove } = voteCounts(idea);
        const me = nameKey(window.wikiStore?.getAuthor() || "");
        const mine = me && idea.votes?.[me]?.vote;
        const voters = (list) => list.map((vote) => vote.name).join(", ");
        const votedAt = (vote) => vote.date ? ` (${new Date(vote.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })})` : "";
        const votersWithTimes = (list) => list.map((vote) => `${vote.name}${votedAt(vote)}`).join(", ");
        const card = element("article", { className: `idea-card${idea.pending ? " wiki-pending-item" : ""}`, id: idea.id },
            element("header", { className: "idea-header" },
                element("h3", { text: idea.number ? `${idea.number}. ${idea.title}` : idea.title }),
                element("span", { className: "idea-meta" },
                    element("span", { className: "idea-author", text: idea.author }),
                    idea.status ? element("span", { className: `idea-badge idea-badge-${idea.status}`, text: idea.status }) : null,
                    " · ",
                    idea.source === "site" && idea.created ? timestamp(idea.created, "added ") : fromDocument())),
            idea.pending ? reviewBar(`new idea by ${idea.author}`,
                () => moderate(true, `idea: ${idea.title}`, (fresh) => {
                    const target = fresh.ideas.find((item) => item.id === idea.id);
                    if (!target?.pending) return false;
                    delete target.pending;
                }),
                () => moderate(false, `idea: ${idea.title}`, (fresh) => {
                    const index = fresh.ideas.findIndex((item) => item.id === idea.id && item.pending);
                    if (index < 0) return false;
                    fresh.ideas.splice(index, 1);
                })) : null,
            idea.description ? element("div", { className: "idea-description" }, renderText(idea.description)) : null);
        // Long write-ups start folded so the list stays easy to scan.
        if ((idea.description || "").length > 450) {
            const body = card.querySelector(".idea-description");
            body.classList.toggle("idea-collapsed", !expandedIdeas.has(idea.id));
            const toggle = element("button", { type: "button", className: "wiki-link-button idea-more", text: expandedIdeas.has(idea.id) ? "Show less" : "Show more" });
            toggle.addEventListener("click", () => {
                const collapsed = body.classList.toggle("idea-collapsed");
                if (collapsed) expandedIdeas.delete(idea.id);
                else expandedIdeas.add(idea.id);
                toggle.textContent = collapsed ? "Show more" : "Show less";
            });
            card.append(toggle);
        }
        if (idea.comments?.length) {
            const details = element("details", { className: "idea-comments" },
                element("summary", { text: `Comments from the document (${idea.comments.length}) · synced ${formatDate(documentSynced)}` }),
                element("ul", {}, ...idea.comments.map((comment) => element("li", { text: comment }))));
            card.append(details);
        }
        const replies = idea.replies || [];
        if (replies.length) {
            card.append(element("ul", { className: "idea-replies" },
                ...replies.map((item) => element("li", { className: item.pending ? "wiki-pending-item" : null },
                    element("div", { className: "idea-meta" },
                        element("span", { className: "idea-author", text: item.author }), " · ", timestamp(item.date)),
                    element("div", { className: "idea-description" }, renderText(item.text)),
                    item.pending ? reviewBar(`comment by ${item.author}`,
                        () => moderate(true, `comment by ${item.author} on idea: ${idea.title}`, (fresh) => {
                            const target = fresh.ideas.find((other) => other.id === idea.id)?.replies?.find(sameEntry(item));
                            if (!target?.pending) return false;
                            delete target.pending;
                        }),
                        () => moderate(false, `comment by ${item.author} on idea: ${idea.title}`, (fresh) => {
                            const list = fresh.ideas.find((other) => other.id === idea.id)?.replies || [];
                            const index = list.findIndex((other) => sameEntry(item)(other) && other.pending);
                            if (index < 0) return false;
                            list.splice(index, 1);
                        })) : null))));
        }
        const commentInput = element("input", { type: "text", placeholder: "Add a comment…", maxlength: 2000, "aria-label": `Comment on ${idea.title}` });
        card.append(element("form", {
            className: "idea-comment-form",
            onsubmit: (event) => {
                event.preventDefault();
                if (commentInput.value.trim()) comment(idea, commentInput.value.trim());
            }
        }, commentInput, element("button", { type: "submit", text: "Comment" })));
        card.append(element("div", { className: "idea-votes" },
            element("button", {
                type: "button", className: "idea-vote idea-vote-approve", "aria-pressed": String(mine === "approve"),
                title: approve.length ? `Approved by ${votersWithTimes(approve)}` : "No approvals yet",
                onclick: () => vote(idea, "approve")
            }, `👍 Approve · ${approve.length}`),
            element("button", {
                type: "button", className: "idea-vote idea-vote-disapprove", "aria-pressed": String(mine === "disapprove"),
                title: disapprove.length ? `Disapproved by ${votersWithTimes(disapprove)}` : "No disapprovals yet",
                onclick: () => vote(idea, "disapprove")
            }, `👎 Disapprove · ${disapprove.length}`),
            approve.length || disapprove.length
                ? element("span", { className: "idea-voters", text: [approve.length ? `For: ${voters(approve)}` : "", disapprove.length ? `Against: ${voters(disapprove)}` : ""].filter(Boolean).join(" · ") })
                : null));
        if (canDelete(idea)) {
            card.append(element("button", { type: "button", className: "wiki-link-button idea-delete", text: "Delete idea", onclick: () => setArchived(idea, true) }));
        }
        return card;
    }

    function renderIdeas() {
        const activeIdeas = data.ideas.filter((idea) => !idea.archived);
        const authors = [...new Set(activeIdeas.map((idea) => idea.author))];
        const toolbar = element("div", { className: "controversy-toolbar" },
            element("button", { type: "button", className: "wiki-primary-button", text: "+ Add idea", onclick: addIdea }),
            element("label", {}, "Person ",
                element("select", { onchange: (event) => { ideaFilters.author = event.target.value; render(); } },
                    element("option", { value: "", text: `Everyone (${activeIdeas.length})` }),
                    ...authors.map((author) => element("option", { value: author, selected: ideaFilters.author === author, text: `${author} (${activeIdeas.filter((idea) => idea.author === author).length})` })))),
            element("label", {}, "Sort ",
                element("select", { onchange: (event) => { ideaFilters.sort = event.target.value; render(); } },
                    ...[["document", "Document order"], ["approved", "Most approved"], ["disapproved", "Most disapproved"], ["newest", "Newest first"]]
                        .map(([value, label]) => element("option", { value, selected: ideaFilters.sort === value, text: label })))),
            element("input", {
                type: "search", placeholder: "Filter ideas…", value: ideaFilters.query, "aria-label": "Filter ideas",
                oninput: (event) => { ideaFilters.query = event.target.value; renderList(); }
            }));
        const list = element("div", { className: "idea-list" });
        function renderList() {
            const query = ideaFilters.query.trim().toLowerCase();
            let ideas = activeIdeas.map((idea, index) => ({ idea, index }))
                .filter(({ idea }) => !ideaFilters.author || idea.author === ideaFilters.author)
                .filter(({ idea }) => !query || `${idea.title} ${idea.description} ${idea.author}`.toLowerCase().includes(query));
            const score = (idea, kind) => voteCounts(idea)[kind].length;
            if (ideaFilters.sort === "approved") ideas.sort((a, b) => score(b.idea, "approve") - score(a.idea, "approve") || a.index - b.index);
            if (ideaFilters.sort === "disapproved") ideas.sort((a, b) => score(b.idea, "disapprove") - score(a.idea, "disapprove") || a.index - b.index);
            if (ideaFilters.sort === "newest") ideas.sort((a, b) => b.index - a.index);
            list.replaceChildren(...(ideas.length ? ideas.map(({ idea }) => renderIdea(idea)) : [element("p", { text: "No ideas match." })]));
        }
        renderList();
        ideasApp.replaceChildren(toolbar, account, status, list);
    }

    // Threads & Debates page ----------------------------------------------------------------------
    const openDiscussions = new Set();

    function reply(discussion, text) {
        requireSignIn(`Post your reply in "${discussion.title}".`, (name) =>
            save((fresh, role) => {
                const target = (fresh.discussions || []).find((item) => item.id === discussion.id);
                if (!target) throw new Error("This discussion no longer exists. Reload the page.");
                target.posts = target.posts || [];
                target.posts.push({ author: name, text, date: new Date().toISOString(), source: "site", ...pendingMark(role) });
            }, `${name} replies in: ${discussion.title}`)
                .then(() => { status.textContent = "Your reply was posted."; }));
    }

    function startDiscussion() {
        if (!signedIn()) {
            location.href = window.wikiStore.loginHref();
            return;
        }
        if (isReviewer()) {
            status.textContent = "Reviewers can reply in threads and debates but can't start new ones.";
            return;
        }
        openFormDialog({
            title: "Start a debate or thread",
            submitLabel: "Save",
            fields: [
                { name: "kind", label: "Type", type: "select", options: [["debate", "Debate"], ["thread", "Thread"]] },
                { name: "title", label: "Title", required: true },
                { name: "text", label: "First post", type: "textarea", required: true, rows: 7 }
            ],
            onSubmit: (values) => requireSignIn(`Start the ${values.kind} "${values.title}".`, (name) => {
                const id = newId(values.kind);
                return save((fresh) => {
                    fresh.discussions = fresh.discussions || [];
                    fresh.discussions.unshift({
                        id, kind: values.kind, title: values.title, date: new Date().toISOString().slice(0, 10),
                        participants: "", archived: false, resolved: false, source: "site", author: name,
                        posts: [{ author: name, text: values.text, date: new Date().toISOString(), source: "site" }]
                    });
                }, `${name} starts ${values.kind}: ${values.title}`).then(() => {
                    openDiscussions.add(id);
                    render();
                    status.textContent = `Your ${values.kind} was started.`;
                });
            })
        });
    }

    // "Caleb v. Aadi · started Oct 8, 2026 · 18 posts · last post Nov 6, 2026, 3:07 PM"
    function summaryMeta(discussion, posts) {
        const parts = [];
        const add = (...nodes) => {
            if (parts.length) parts.push(" · ");
            parts.push(...nodes);
        };
        if (discussion.participants) add(discussion.participants);
        if (discussion.date) add(timestamp(discussion.source === "site" && posts[0]?.date ? posts[0].date : discussion.date, "started "));
        add(`${posts.length} post${posts.length === 1 ? "" : "s"}`);
        const latest = posts.filter((post) => post.source === "site" && post.date).pop();
        if (latest && posts.length > 1) add(timestamp(latest.date, "last post "));
        if (discussion.resolved) add("resolved");
        if (discussion.archived) add("archived");
        return parts;
    }

    function renderDiscussion(discussion) {
        const posts = discussion.posts || [];
        const details = element("details", { className: `discussion discussion-${discussion.kind}`, id: discussion.id, open: openDiscussions.has(discussion.id) },
            element("summary", {},
                element("span", { className: `idea-badge idea-badge-${discussion.kind}`, text: discussion.kind }),
                element("strong", { text: discussion.title }),
                element("span", { className: "idea-meta" }, ...summaryMeta(discussion, posts))));
        details.addEventListener("toggle", () => {
            if (details.open) openDiscussions.add(discussion.id);
            else openDiscussions.delete(discussion.id);
        });
        const list = element("ol", { className: "discussion-posts" },
            ...posts.map((post) => element("li", { className: `discussion-post${post.pending ? " wiki-pending-item" : ""}` },
                element("div", { className: "idea-meta" },
                    element("span", { className: "idea-author", text: post.author || "Unknown" }),
                    " · ",
                    post.source === "site" && post.date ? timestamp(post.date) : fromDocument()),
                element("div", { className: "idea-description" }, renderText(post.text)),
                post.pending ? reviewBar(`reply by ${post.author}`,
                    () => moderate(true, `reply by ${post.author} in: ${discussion.title}`, (fresh) => {
                        const target = fresh.discussions.find((other) => other.id === discussion.id)?.posts?.find(sameEntry(post));
                        if (!target?.pending) return false;
                        delete target.pending;
                    }),
                    () => moderate(false, `reply by ${post.author} in: ${discussion.title}`, (fresh) => {
                        const list = fresh.discussions.find((other) => other.id === discussion.id)?.posts || [];
                        const index = list.findIndex((other) => sameEntry(post)(other) && other.pending);
                        if (index < 0) return false;
                        list.splice(index, 1);
                    })) : null)));
        const textarea = element("textarea", { rows: 3, placeholder: "Write a reply…", "aria-label": `Reply to ${discussion.title}`, maxlength: 8000 });
        const form = element("form", {
            className: "discussion-reply",
            onsubmit: (event) => {
                event.preventDefault();
                if (textarea.value.trim()) reply(discussion, textarea.value.trim());
            }
        }, textarea, element("button", { type: "submit", text: "Reply" }));
        details.append(list, form);
        return details;
    }

    function renderDiscussions() {
        const groups = [
            ["Debates", data.discussions.filter((item) => item.kind === "debate" && !item.archived)],
            ["Threads", data.discussions.filter((item) => item.kind === "thread" && !item.archived)]
        ];
        const toolbar = element("div", { className: "controversy-toolbar" },
            isReviewer()
                ? element("span", { className: "idea-meta", text: "Reviewers can reply in threads and debates but can't start new ones." })
                : element("button", { type: "button", className: "wiki-primary-button", text: "+ New debate or thread", onclick: startDiscussion }));
        const sections = groups.filter(([, items]) => items.length).map(([title, items]) =>
            element("section", { className: "discussion-group" },
                element("h2", { text: `${title} (${items.length})` }),
                ...items.map(renderDiscussion)));
        discussionsApp.replaceChildren(toolbar, account, status, ...sections);
    }

    // Archives page -------------------------------------------------------------------------------
    function renderArchivedIdea(idea) {
        const { approve, disapprove } = voteCounts(idea);
        return element("article", { className: "idea-card", id: idea.id },
            element("header", { className: "idea-header" },
                element("h3", { text: idea.number ? `${idea.number}. ${idea.title}` : idea.title }),
                element("span", { className: "idea-meta" },
                    element("span", { className: "idea-author", text: idea.author }),
                    " · ",
                    idea.archivedDate ? timestamp(idea.archivedDate, "deleted ") : "deleted",
                    idea.archivedBy ? ` by ${idea.archivedBy}` : "")),
            idea.description ? element("div", { className: "idea-description" }, renderText(idea.description)) : null,
            element("p", { className: "idea-meta", text: `👍 ${approve.length} · 👎 ${disapprove.length} · ${(idea.replies || []).length + (idea.comments || []).length} comments` }),
            canDelete(idea) ? element("button", { type: "button", className: "wiki-primary-button", text: "Restore", onclick: () => setArchived(idea, false) }) : null);
    }

    function renderArchives() {
        const ideas = data.ideas.filter((idea) => idea.archived);
        const discussions = data.discussions.filter((item) => item.archived);
        const section = (title, items) => items.length ? element("section", { className: "discussion-group" }, element("h2", { text: `${title} (${items.length})` }), ...items) : null;
        archivesApp.replaceChildren(...[account, status,
            section("Ideas", ideas.map(renderArchivedIdea)),
            section("Debates and threads", discussions.map(renderDiscussion)),
            ideas.length || discussions.length ? null : element("p", { text: "Nothing has been archived yet." })].filter(Boolean));
    }

    function render() {
        renderAccount();
        if (ideasApp) renderIdeas();
        else if (archivesApp) renderArchives();
        else renderDiscussions();
    }

    loadData().then(() => {
        const id = location.hash.slice(1);
        // Old links to archived discussions and ideas still arrive
        if (discussionsApp && data.discussions.some((item) => item.id === id && item.archived)) {
            location.replace(`archives.html${location.hash}`);
            return;
        }
        if (archivesApp && id) openDiscussions.add(id);
        render();
        if (archivesApp && id) document.getElementById(id)?.scrollIntoView({ block: "start" });
        // Other people's votes, comments and replies appear without reloading
        window.wikiStore?.watchJson(dataFile, (fresh) => {
            data = { ...fresh, ideas: fresh.ideas || [], discussions: fresh.discussions || [] };
            window.wikiStore.keepInputs([app], render);
        });
    }).catch((error) => {
        app.replaceChildren(element("p", { className: "wiki-dialog-error", text: error.message }));
    });

    // Open a linked idea or discussion (page.html#id).
    window.addEventListener("hashchange", () => {
        const id = location.hash.slice(1);
        if ((discussionsApp || archivesApp) && id) {
            openDiscussions.add(id);
            render();
        }
        document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
})();
