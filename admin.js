(() => {
    const app = document.querySelector("#admin-app");
    const store = window.wikiStore;
    if (!app || !store) {
        return;
    }

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

    const formatTime = (value) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const status = element("p", { className: "controversy-status", role: "status" });
    const me = store.getAuthor();
    let accounts = {};

    if (!store.canReview()) {
        app.replaceChildren(element("p", {}, store.isSignedIn()
            ? "Only admins and editors can use this panel."
            : element("a", { href: store.loginHref() }, "Log in as an admin or editor to use this panel.")));
        return;
    }

    async function change(apply, message, done) {
        status.textContent = "Saving…";
        try {
            const saved = await store.updateAccounts(apply, message);
            accounts = saved.accounts || {};
            status.textContent = done;
        } catch (error) {
            status.textContent = `Could not save: ${error.message}`;
        }
        render();
    }

    function setRole(key, role) {
        const name = accounts[key].name;
        change((data) => { data.accounts[key].role = role; }, `${me} sets role of ${name} to ${role}`, `${name} is now ${{ admin: "an admin", editor: "an editor", reviewer: "a reviewer" }[role]}.`);
    }

    function block(key, until) {
        const name = accounts[key].name;
        // until is a timestamp from the quick buttons or the text of the date picker
        const time = typeof until === "number" ? until : Date.parse(until);
        if (!time || time <= Date.now()) {
            status.textContent = "Pick a time in the future to block until.";
            return;
        }
        const iso = new Date(time).toISOString();
        change((data) => { data.accounts[key].blockedUntil = iso; }, `${me} blocks ${name} until ${formatTime(iso)}`, `${name} is blocked until ${formatTime(iso)}.`);
    }

    function unblock(key) {
        const name = accounts[key].name;
        change((data) => { delete data.accounts[key].blockedUntil; }, `${me} unblocks ${name}`, `${name} is unblocked.`);
    }

    function renderAccounts() {
        const rows = Object.entries(accounts).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([key, account]) => {
            const role = account.role || "editor";
            const self = account.name.toLowerCase() === me.toLowerCase();
            const blocked = account.blockedUntil && Date.parse(account.blockedUntil) > Date.now();
            const custom = element("input", { type: "datetime-local", "aria-label": `Block ${account.name} until` });
            return element("tr", {},
                element("td", {}, element("strong", { text: account.name }), self ? " (you)" : null),
                element("td", {}, self
                    ? element("span", { className: `idea-badge role-badge role-${role}`, text: role })
                    : element("select", { "aria-label": `Role of ${account.name}`, onchange: (event) => setRole(key, event.target.value) },
                        ...store.roles.map((value) => element("option", { value, selected: value === role, text: value })))),
                element("td", { text: account.created ? formatTime(account.created) : "" }),
                element("td", {}, blocked ? element("span", { className: "admin-blocked", text: `Blocked until ${formatTime(account.blockedUntil)}` }) : "Active"),
                element("td", { className: "admin-actions" }, role !== "reviewer"
                    ? element("span", { className: "idea-meta", text: "Only reviewers can be blocked" })
                    : blocked
                        ? element("button", { type: "button", text: "Unblock", onclick: () => unblock(key) })
                        : element("span", {},
                            element("button", { type: "button", text: "1 day", onclick: () => block(key, Date.now() + 864e5) }),
                            element("button", { type: "button", text: "1 week", onclick: () => block(key, Date.now() + 7 * 864e5) }),
                            custom,
                            element("button", { type: "button", text: "Block until", onclick: () => block(key, custom.value) }))));
        });
        return element("section", { className: "admin-section" },
            element("h2", { text: "Accounts" }),
            rows.length
                ? element("div", { className: "admin-table-wrap" }, element("table", { className: "admin-table" },
                    element("thead", {}, element("tr", {}, ...["Account", "Role", "Registered", "Status", "Block"].map((text) => element("th", { text })))),
                    element("tbody", {}, ...rows)))
                : element("p", { text: "No accounts yet." }),
            element("p", { className: "wiki-dialog-hint", text: "Admins: everything goes live, approve reviews, use this panel. Editors: everything goes live, approve reviews. Reviewers: votes count straight away, other changes wait for an admin or editor, can't start threads, new pages are [draft] pages. Blocked reviewers can't log in or save until the block ends." }));
    }

    function renderReviewPassword(isSet) {
        const input = element("input", { type: "password", autocomplete: "new-password", "aria-label": "Review password", minlength: 8 });
        const form = element("form", { className: "login-actions" }, input, element("button", { type: "submit", className: "wiki-primary-button", text: isSet ? "Change review password" : "Set review password" }));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            status.textContent = "Saving…";
            try {
                await store.setReviewPassword(input.value);
                status.textContent = "The review password is saved. Reviewers can register and log in with it in a minute or two, once the site updates.";
                input.value = "";
            } catch (error) {
                status.textContent = `Could not save: ${error.message}`;
            }
        });
        return element("section", { className: "admin-section" },
            element("h2", { text: "Review password" }),
            element("p", {}, isSet ? "A review password is set. Changing it means reviewers use the new one from now on." : "Not set yet: reviewers can't register or log in until it is."),
            form);
    }

    async function approveAll(event) {
        if (!window.confirm("Approve everything waiting for review, including page edits and drafts?")) return;
        event.target.disabled = true;
        status.textContent = "Approving…";
        try {
            const count = await store.approveAllReviews();
            status.textContent = `Approved ${count} item${count === 1 ? "" : "s"}. The list follows the live site, so they can take a minute to drop off.`;
            queue = element("section", { className: "admin-section" }, element("h2", { text: "Waiting for review" }), element("p", { text: "Everything was approved." }));
            render();
        } catch (error) {
            event.target.disabled = false;
            status.textContent = `Could not approve everything: ${error.message}`;
        }
    }

    async function renderQueue() {
        const json = (file) => fetch(file, { cache: "no-cache" }).then((response) => response.ok ? response.json() : {}).catch(() => ({}));
        const [ideas, bugs, pages, annotations] = await Promise.all([json("controversy.json"), json("bugs.json"), json("pending-pages.json"), json("annotations.json")]);
        const items = [];
        for (const idea of (ideas.ideas || []).filter((item) => !item.archived)) {
            if (idea.pending) items.push([`New idea by ${idea.author}: ${idea.title}`, `ideas.html#${idea.id}`]);
            for (const reply of idea.replies || []) if (reply.pending) items.push([`Comment by ${reply.author} on ${idea.title}`, `ideas.html#${idea.id}`]);
        }
        for (const discussion of ideas.discussions || []) {
            for (const post of discussion.posts || []) if (post.pending) items.push([`Reply by ${post.author} in ${discussion.title}`, `discussions.html#${discussion.id}`]);
        }
        for (const bug of bugs.bugs || []) {
            if (bug.pending) items.push([`Bug report by ${bug.reporter}: ${bug.title}`, `bugs.html#${bug.id}`]);
            for (const comment of bug.comments || []) if (comment.pending) items.push([`Comment by ${comment.author} on bug ${bug.title}`, `bugs.html#${bug.id}`]);
        }
        for (const annotation of annotations.annotations || []) {
            for (const item of [annotation, ...(annotation.replies || [])]) if (item.pending) items.push([`Comment by ${item.author} on ${annotation.pageTitle}`, `${annotation.page}#${annotation.id}`]);
        }
        for (const [file, page] of Object.entries(pages.pages || {})) items.push([`Page edits by ${page.by}: ${page.title}`, file]);
        return element("section", { className: "admin-section" },
            element("h2", { text: `Waiting for review (${items.length})` }),
            items.length
                ? element("button", { type: "button", className: "wiki-review-approve", text: `Approve all (${items.length})`, onclick: approveAll })
                : null,
            items.length
                ? element("ul", {}, ...items.map(([text, href]) => element("li", {}, element("a", { href, text }))))
                : element("p", { text: "Nothing is waiting for review." }),
            element("p", { className: "wiki-dialog-hint", text: "Open an item to approve or disapprove it. The list follows the live site, so a review you just saved can take a minute to drop off." }));
    }

    let queue = element("section", { className: "admin-section" }, element("p", { text: "Loading the review queue…" }));
    let reviewSection = renderReviewPassword(false);

    function render() {
        app.replaceChildren(...(store.isAdmin() ? [status, queue, renderAccounts(), reviewSection] : [status, queue]));
    }

    Promise.all(store.isAdmin() ? [store.readAccounts(), store.hasReviewPassword(), renderQueue()] : [{}, false, renderQueue()]).then(([data, reviewSet, queueSection]) => {
        accounts = data.accounts || {};
        reviewSection = renderReviewPassword(reviewSet);
        queue = queueSection;
        render();
    }).catch((error) => {
        status.textContent = error.message;
        render();
    });
    render();
})();
