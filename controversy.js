// Ideas and Threads & Debates pages, backed by controversy.json in the repository.
// Reading is open to everyone; voting, adding ideas and posting need your name and the wiki password.
(() => {
    const dataFile = "controversy.json";
    const ideasApp = document.querySelector("#ideas-app");
    const discussionsApp = document.querySelector("#discussions-app");
    const app = ideasApp || discussionsApp;
    if (!app) {
        return;
    }

    let data = { ideas: [], discussions: [] };

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

    // Sign-in dialog: your name and the wiki password -----------------------------------------
    const authDialog = element("dialog", { className: "wiki-dialog", "data-wiki-injected": true });
    authDialog.innerHTML = `
        <form method="dialog">
            <h2>Sign your change</h2>
            <p class="wiki-dialog-hint wiki-auth-reason"></p>
            <label for="controversy-name">Your name</label>
            <input id="controversy-name" type="text" required maxlength="40" autocomplete="name">
            <div class="wiki-auth-password">
                <label for="controversy-password">Wiki password</label>
                <input id="controversy-password" type="password" autocomplete="current-password">
                <p class="wiki-dialog-hint">Ask the wiki owner for the password. It stays unlocked until you close this tab.</p>
            </div>
            <p class="wiki-dialog-error" role="alert"></p>
            <div class="wiki-dialog-actions">
                <button type="button" value="cancel">Cancel</button>
                <button type="submit" class="wiki-primary">Continue</button>
            </div>
        </form>
    `;
    document.body.append(authDialog);
    const authName = authDialog.querySelector("#controversy-name");
    const authPassword = authDialog.querySelector("#controversy-password");
    const authPasswordField = authDialog.querySelector(".wiki-auth-password");
    const authError = authDialog.querySelector(".wiki-dialog-error");
    const authSubmit = authDialog.querySelector('button[type="submit"]');
    let pendingAction = null;

    authDialog.querySelector('button[value="cancel"]').addEventListener("click", () => authDialog.close());

    // Ask for name (and the password if this tab is not unlocked), then run action(name, password).
    function requireSignIn(reason, action) {
        const store = window.wikiStore;
        if (!store) {
            alert("The wiki editor did not load, so changes cannot be saved right now.");
            return;
        }
        pendingAction = action;
        authDialog.querySelector(".wiki-auth-reason").textContent = reason;
        authName.value = store.getAuthor();
        authPassword.value = "";
        const unlocked = store.isUnlocked();
        authPasswordField.hidden = unlocked;
        authPassword.required = !unlocked;
        authError.textContent = "";
        authSubmit.disabled = false;
        authSubmit.textContent = "Continue";
        authDialog.showModal();
        (authName.value ? (unlocked ? authSubmit : authPassword) : authName).focus();
    }

    authDialog.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = authName.value.trim().replace(/\s+/g, " ");
        if (!name) return;
        authSubmit.disabled = true;
        authSubmit.textContent = "Saving…";
        authError.textContent = "";
        try {
            window.wikiStore.setAuthor(name);
            await pendingAction(name, authPassword.value);
            authDialog.close();
        } catch (error) {
            authError.textContent = error.message;
            authSubmit.disabled = false;
            authSubmit.textContent = "Try again";
            if (!window.wikiStore.isUnlocked()) {
                authPasswordField.hidden = false;
                authPassword.required = true;
            }
        }
    });

    // Commit a change to controversy.json and show the saved result straight away
    // (the live site takes a minute to publish it).
    async function save(change, message, password) {
        data = await window.wikiStore.updateJson(dataFile, change, message, password);
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
        requireSignIn(`${choice === "approve" ? "Approve" : "Disapprove"} "${idea.title}". Voting the same way again removes your vote.`, (name, password) =>
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
            }, `${name} votes ${choice} on idea: ${idea.title}`, password)
                .then(() => { status.textContent = `Your vote on "${idea.title}" was saved.`; }));
    }

    function addIdea() {
        openFormDialog({
            title: "Add an idea",
            submitLabel: "Next",
            fields: [
                { name: "title", label: "Idea name", required: true },
                { name: "description", label: "Details", type: "textarea", rows: 8, hint: "Start a line with \"- \" to make a bullet point." }
            ],
            onSubmit: (values) => requireSignIn(`Add the idea "${values.title}" under your name.`, (name, password) =>
                save((fresh) => {
                    fresh.ideas = fresh.ideas || [];
                    fresh.ideas.push({
                        id: newId("idea"), author: name, title: values.title, description: values.description,
                        comments: [], status: "", source: "site", created: new Date().toISOString(), votes: {}
                    });
                }, `${name} adds idea: ${values.title}`, password)
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
        const card = element("article", { className: "idea-card", id: idea.id },
            element("header", { className: "idea-header" },
                element("h3", { text: idea.number ? `${idea.number}. ${idea.title}` : idea.title }),
                element("span", { className: "idea-meta" },
                    element("span", { className: "idea-author", text: idea.author }),
                    idea.status ? element("span", { className: `idea-badge idea-badge-${idea.status}`, text: idea.status }) : null,
                    idea.source === "site" && idea.created ? element("span", { text: ` · added ${formatDate(idea.created)}` }) : null)),
            idea.description ? element("div", { className: "idea-description" }, renderText(idea.description)) : null);
        // Long write-ups start folded so the list stays easy to scan.
        if ((idea.description || "").length > 450) {
            const body = card.querySelector(".idea-description");
            body.classList.add("idea-collapsed");
            const toggle = element("button", { type: "button", className: "wiki-link-button idea-more", text: "Show more" });
            toggle.addEventListener("click", () => {
                const collapsed = body.classList.toggle("idea-collapsed");
                toggle.textContent = collapsed ? "Show more" : "Show less";
            });
            card.append(toggle);
        }
        if (idea.comments?.length) {
            const details = element("details", { className: "idea-comments" },
                element("summary", { text: `Comments from the document (${idea.comments.length})` }),
                element("ul", {}, ...idea.comments.map((comment) => element("li", { text: comment }))));
            card.append(details);
        }
        card.append(element("div", { className: "idea-votes" },
            element("button", {
                type: "button", className: "idea-vote idea-vote-approve", "aria-pressed": String(mine === "approve"),
                title: approve.length ? `Approved by ${voters(approve)}` : "No approvals yet",
                onclick: () => vote(idea, "approve")
            }, `👍 Approve · ${approve.length}`),
            element("button", {
                type: "button", className: "idea-vote idea-vote-disapprove", "aria-pressed": String(mine === "disapprove"),
                title: disapprove.length ? `Disapproved by ${voters(disapprove)}` : "No disapprovals yet",
                onclick: () => vote(idea, "disapprove")
            }, `👎 Disapprove · ${disapprove.length}`),
            approve.length || disapprove.length
                ? element("span", { className: "idea-voters", text: [approve.length ? `For: ${voters(approve)}` : "", disapprove.length ? `Against: ${voters(disapprove)}` : ""].filter(Boolean).join(" · ") })
                : null));
        return card;
    }

    function renderIdeas() {
        const authors = [...new Set(data.ideas.map((idea) => idea.author))];
        const toolbar = element("div", { className: "controversy-toolbar" },
            element("button", { type: "button", className: "wiki-primary-button", text: "+ Add idea", onclick: addIdea }),
            element("label", {}, "Person ",
                element("select", { onchange: (event) => { ideaFilters.author = event.target.value; render(); } },
                    element("option", { value: "", text: `Everyone (${data.ideas.length})` }),
                    ...authors.map((author) => element("option", { value: author, selected: ideaFilters.author === author, text: `${author} (${data.ideas.filter((idea) => idea.author === author).length})` })))),
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
            let ideas = data.ideas.map((idea, index) => ({ idea, index }))
                .filter(({ idea }) => !ideaFilters.author || idea.author === ideaFilters.author)
                .filter(({ idea }) => !query || `${idea.title} ${idea.description} ${idea.author}`.toLowerCase().includes(query));
            const score = (idea, kind) => voteCounts(idea)[kind].length;
            if (ideaFilters.sort === "approved") ideas.sort((a, b) => score(b.idea, "approve") - score(a.idea, "approve") || a.index - b.index);
            if (ideaFilters.sort === "disapproved") ideas.sort((a, b) => score(b.idea, "disapprove") - score(a.idea, "disapprove") || a.index - b.index);
            if (ideaFilters.sort === "newest") ideas.sort((a, b) => b.index - a.index);
            list.replaceChildren(...(ideas.length ? ideas.map(({ idea }) => renderIdea(idea)) : [element("p", { text: "No ideas match." })]));
        }
        renderList();
        ideasApp.replaceChildren(toolbar, status, list);
    }

    // Threads & Debates page ----------------------------------------------------------------------
    const openDiscussions = new Set();

    function reply(discussion, text) {
        requireSignIn(`Post your reply in "${discussion.title}".`, (name, password) =>
            save((fresh) => {
                const target = (fresh.discussions || []).find((item) => item.id === discussion.id);
                if (!target) throw new Error("This discussion no longer exists. Reload the page.");
                target.posts = target.posts || [];
                target.posts.push({ author: name, text, date: new Date().toISOString(), source: "site" });
            }, `${name} replies in: ${discussion.title}`, password)
                .then(() => { status.textContent = "Your reply was posted."; }));
    }

    function startDiscussion() {
        openFormDialog({
            title: "Start a debate or thread",
            submitLabel: "Next",
            fields: [
                { name: "kind", label: "Type", type: "select", options: [["debate", "Debate"], ["thread", "Thread"]] },
                { name: "title", label: "Title", required: true },
                { name: "text", label: "First post", type: "textarea", required: true, rows: 7 }
            ],
            onSubmit: (values) => requireSignIn(`Start the ${values.kind} "${values.title}".`, (name, password) => {
                const id = newId(values.kind);
                return save((fresh) => {
                    fresh.discussions = fresh.discussions || [];
                    fresh.discussions.unshift({
                        id, kind: values.kind, title: values.title, date: new Date().toISOString().slice(0, 10),
                        participants: "", archived: false, resolved: false, source: "site", author: name,
                        posts: [{ author: name, text: values.text, date: new Date().toISOString(), source: "site" }]
                    });
                }, `${name} starts ${values.kind}: ${values.title}`, password).then(() => {
                    openDiscussions.add(id);
                    render();
                    status.textContent = `Your ${values.kind} was started.`;
                });
            })
        });
    }

    function renderDiscussion(discussion) {
        const posts = discussion.posts || [];
        const details = element("details", { className: `discussion discussion-${discussion.kind}`, id: discussion.id, open: openDiscussions.has(discussion.id) },
            element("summary", {},
                element("span", { className: `idea-badge idea-badge-${discussion.kind}`, text: discussion.kind }),
                element("strong", { text: discussion.title }),
                element("span", { className: "idea-meta", text: [discussion.participants, discussion.date ? formatDate(discussion.date) : "", `${posts.length} post${posts.length === 1 ? "" : "s"}`, discussion.resolved ? "resolved" : "", discussion.archived ? "archived" : ""].filter(Boolean).join(" · ") })));
        details.addEventListener("toggle", () => {
            if (details.open) openDiscussions.add(discussion.id);
            else openDiscussions.delete(discussion.id);
        });
        const list = element("ol", { className: "discussion-posts" },
            ...posts.map((post) => element("li", { className: "discussion-post" },
                element("div", { className: "idea-meta" },
                    element("span", { className: "idea-author", text: post.author || "Unknown" }),
                    post.source === "site" && post.date ? element("span", { text: ` · ${formatDate(post.date)}` }) : null),
                element("div", { className: "idea-description" }, renderText(post.text)))));
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
            ["Threads", data.discussions.filter((item) => item.kind === "thread" && !item.archived)],
            ["Archive", data.discussions.filter((item) => item.archived)]
        ];
        const toolbar = element("div", { className: "controversy-toolbar" },
            element("button", { type: "button", className: "wiki-primary-button", text: "+ New debate or thread", onclick: startDiscussion }));
        const sections = groups.filter(([, items]) => items.length).map(([title, items]) =>
            element("section", { className: "discussion-group" },
                element("h2", { text: `${title} (${items.length})` }),
                ...items.map(renderDiscussion)));
        discussionsApp.replaceChildren(toolbar, status, ...sections);
    }

    function render() {
        if (ideasApp) renderIdeas();
        else renderDiscussions();
    }

    loadData().then(render).catch((error) => {
        app.replaceChildren(element("p", { className: "wiki-dialog-error", text: error.message }));
    });

    // Open a linked idea or discussion (page.html#id).
    window.addEventListener("hashchange", () => {
        const id = location.hash.slice(1);
        if (discussionsApp && id) {
            openDiscussions.add(id);
            render();
        }
        document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
})();
