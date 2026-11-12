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
                element("td", { text: account.emailConfirmed ? "✓ Confirmed" : "—" }),
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
                    element("thead", {}, element("tr", {}, ...["Account", "Role", "Registered", "Email", "Status", "Block"].map((text) => element("th", { text })))),
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

    // The wiki password admins and editors log in with. Everyone needs the new one afterwards, so it asks twice.
    function renderWikiPassword() {
        const field = (label, autocomplete) => element("input", { type: "password", autocomplete, placeholder: label, "aria-label": label, required: true });
        const current = field("Current wiki password", "current-password");
        const next = field("New wiki password", "new-password");
        const again = field("Type the new password again", "new-password");
        const button = element("button", { type: "submit", className: "wiki-primary-button", text: "Change wiki password" });
        const form = element("form", { className: "admin-password-form" }, current, next, again, button);
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (next.value !== again.value) {
                status.textContent = "The two new passwords don't match.";
                return;
            }
            if (next.value === current.value) {
                status.textContent = "The new wiki password is the same as the current one.";
                return;
            }
            if (next.value.length < 12) {
                status.textContent = "Use at least 12 characters for the wiki password.";
                return;
            }
            if (!window.confirm("Change the wiki password? Every admin and editor will need the new password the next time they log in.")) return;
            if (!window.confirm("Are you sure? The old wiki password stops working in a minute or two. Make sure you can tell every admin and editor the new one.")) return;
            button.disabled = true;
            status.textContent = "Changing the wiki password…";
            try {
                await store.changeWikiPassword(current.value, next.value);
                form.reset();
                status.textContent = "The wiki password is changed. It works for logging in in a minute or two, once the site updates. Anyone already logged in stays logged in.";
            } catch (error) {
                status.textContent = `Could not change the wiki password: ${error.message}`;
            } finally {
                button.disabled = false;
            }
        });
        return element("section", { className: "admin-section" },
            element("h2", { text: "Wiki password" }),
            element("p", {}, "Admins and editors log in with this password. Use at least 12 characters, ideally four or more random words: the locked file is public, so a short password can be guessed."),
            form);
    }

    // People who forgot their personal password and asked an admin. The temporary password is replaced by one of
    // their own the next time they log in.
    function renderResetRequests() {
        const waiting = Object.values(accounts).filter((account) => account.resetRequested)
            .sort((a, b) => a.resetRequested.localeCompare(b.resetRequested));
        async function reset(account) {
            const password = window.prompt(`Temporary password for ${account.name} (at least 6 characters). Tell it to them yourself; they'll choose their own when they log in.`);
            if (!password) return;
            if (window.prompt(`Type the temporary password for ${account.name} again`) !== password) {
                status.textContent = "The two temporary passwords don't match. Nothing was changed.";
                return;
            }
            status.textContent = "Saving…";
            try {
                await store.setTemporaryPassword(account.name, password);
                accounts = (await store.readAccounts()).accounts || {};
                render();
                status.textContent = `${account.name} has a temporary password now. Tell it to them; they'll pick a new one when they log in.`;
            } catch (error) {
                status.textContent = `Could not reset the password: ${error.message}`;
            }
        }
        return element("section", { className: "admin-section" },
            element("h2", { text: `Password reset requests (${waiting.length})` }),
            waiting.length
                ? element("ul", {}, ...waiting.map((account) => element("li", {},
                    element("strong", { text: account.name }), ` asked ${formatTime(account.resetRequested)} `,
                    element("button", { type: "button", text: "Set temporary password", onclick: () => reset(account) }))))
                : element("p", { text: "Nobody is waiting for a password reset." }),
            element("p", { className: "wiki-dialog-hint", text: "People with a confirmed email address can reset their own password from the login page. The others land here." }));
    }

    // EmailJS sends the codes for confirming email addresses and resetting passwords
    function renderEmailSettings(config) {
        const input = (name, label) => element("input", { type: "text", name, placeholder: label, "aria-label": label, value: config?.[name] || "", required: true, autocomplete: "off", spellcheck: "false" });
        const inputs = [input("serviceId", "Service ID"), input("templateId", "Template ID"), input("publicKey", "Public key")];
        const form = element("form", { className: "admin-password-form" }, ...inputs, element("button", { type: "submit", className: "wiki-primary-button", text: "Save email settings" }));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            status.textContent = "Saving…";
            try {
                await store.setEmailConfig(Object.fromEntries(inputs.map((field) => [field.name, field.value])));
                status.textContent = "Email settings saved. The email options appear for everyone in a minute or two, once the site updates.";
            } catch (error) {
                status.textContent = `Could not save: ${error.message}`;
            }
        });
        return element("section", { className: "admin-section" },
            element("h2", { text: "Email for password recovery" }),
            element("p", {}, config
                ? "Email is set up: people can confirm an email address and reset their own password with a code."
                : "Not set up yet: the email options stay hidden until it is. Password resets go through the requests list above."),
            element("ol", {},
                element("li", {}, "Make a free account at ", element("a", { href: "https://www.emailjs.com/", target: "_blank", rel: "noopener", text: "emailjs.com" }), " and add an email service (for example your Gmail). Copy its Service ID."),
                element("li", {}, "Make an email template. Set its To Email to {{to_email}}, its subject to something like \"Your Strawberry MC wiki code\", and its message to: Hi {{to_name}}, your code to {{purpose}} is {{code}}. Copy its Template ID."),
                element("li", {}, "Under Account, copy your Public Key, and add this site's address to the allowed origins if EmailJS asks."),
                element("li", {}, "Paste all three here. They're saved in the public email-config.json, which is how EmailJS is meant to be used, but it means someone could use them to send emails through your account, so keep the free plan's limits.")),
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
        const [ideas, bugs, pages, annotations, restores] = await Promise.all([json("controversy.json"), json("bugs.json"), json("pending-pages.json"), json("annotations.json"), json("restore-requests.json")]);
        const restoreRequests = restores.requests || [];
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
            element("p", { className: "wiki-dialog-hint", text: "Open an item to approve or disapprove it. The list follows the live site, so a review you just saved can take a minute to drop off." }),
            restoreRequests.length ? element("h3", { text: `Asked to restore an older version (${restoreRequests.length})` }) : null,
            restoreRequests.length
                ? element("ul", {}, ...restoreRequests.map((request) => element("li", {},
                    element("a", { href: `${request.file}#wiki-history`, text: `${request.by}: ${request.title}, back to ${formatTime(request.versionDate)}` }),
                    request.reason ? ` (“${request.reason}”)` : null)))
                : null,
            restoreRequests.length ? element("p", { className: "wiki-dialog-hint", text: "Only admins can restore a page. Open one to see the changes in the page's history and restore it or turn it down." }) : null);
    }

    let queue = element("section", { className: "admin-section" }, element("p", { text: "Loading the review queue…" }));
    let reviewSection = renderReviewPassword(false);
    const wikiPasswordSection = renderWikiPassword();
    let emailSection = renderEmailSettings(null);

    function render() {
        app.replaceChildren(...(store.isAdmin() ? [status, queue, renderResetRequests(), renderAccounts(), wikiPasswordSection, reviewSection, emailSection] : [status, queue]));
    }

    Promise.all(store.isAdmin() ? [store.readAccounts(), store.hasReviewPassword(), renderQueue(), store.readEmailConfig()] : [{}, false, renderQueue(), null]).then(([data, reviewSet, queueSection, emailConfig]) => {
        accounts = data.accounts || {};
        reviewSection = renderReviewPassword(reviewSet);
        emailSection = renderEmailSettings(emailConfig);
        queue = queueSection;
        render();
    }).catch((error) => {
        status.textContent = error.message;
        render();
    });
    render();
})();
