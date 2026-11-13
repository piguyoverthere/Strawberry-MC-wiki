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

    // Bans -----------------------------------------------------------------------------------
    // A ban hides the whole wiki from that account until it ends, showing the admin's own message instead.
    // A restraining order alerts the account with the admin's message, then keeps it in reviewer mode until it ends.
    let bans = {};
    const activeBan = (key) => bans[key] && Date.parse(bans[key].until) > Date.now() ? bans[key] : null;
    const isRestraint = (entry) => entry?.type === "restrain";
    const defaultsFor = (type) => type === "restrain" ? store.restraintDefaults : store.banDefaults;
    const banLengths = [["3600000", "1 hour"], ["86400000", "1 day"], ["259200000", "3 days"], ["604800000", "1 week"], ["2592000000", "30 days"], ["custom", "Until a date…"]];

    async function saveBans(apply, message, done) {
        status.textContent = "Saving…";
        try {
            bans = await store.updateBans(apply, message);
            status.textContent = done;
        } catch (error) {
            status.textContent = `Could not save: ${error.message}`;
        }
        render();
    }

    function unban(key) {
        const name = accounts[key]?.name || bans[key]?.name || key;
        const restraint = isRestraint(bans[key]);
        saveBans((list) => {
            if (!list[key]) return false;
            delete list[key];
        }, restraint ? `${me} lifts the restraining order on ${name}` : `${me} unbans ${name}`,
        restraint ? `The restraining order on ${name} is lifted.` : `${name} is unbanned. It can take a minute before the wiki opens for them again.`);
    }

    function openBanDialog(key, startType = "ban") {
        const account = accounts[key];
        const current = activeBan(key);
        const ban = { ...defaultsFor(current?.type || startType), ...(current || {}) };
        const dialog = element("dialog", { className: "wiki-dialog wiki-ban-dialog", "aria-label": `Ban or restrain ${account.name}` });
        const type = element("select", { id: "ban-type" },
            element("option", { value: "ban", text: "Ban: hide the wiki from them", selected: !isRestraint(ban) }),
            element("option", { value: "restrain", text: "Restraining order: alert them, then reviewer mode", selected: isRestraint(ban) }));
        const heading = element("h2");
        const hint = element("p", { className: "wiki-dialog-hint" });
        const saveButton = element("button", { type: "button", className: "wiki-primary" });
        const close = () => {
            dialog.close();
            dialog.remove();
        };
        const length = element("select", { id: "ban-length" },
            ...(current ? [element("option", { value: "keep", text: `Keep the end (${formatTime(current.until)})` })] : []),
            ...banLengths.map(([value, text]) => element("option", { value, text, selected: !current && value === "86400000" })));
        const custom = element("input", { type: "datetime-local", id: "ban-until", "aria-label": "Ends at", hidden: true });
        const title = element("input", { type: "text", id: "ban-title", maxlength: "80", value: ban.title });
        const message = element("textarea", { id: "ban-message", rows: "4", maxlength: "1000" });
        message.value = ban.message;
        const style = element("select", { id: "ban-style" },
            ...Object.entries(store.banStyles).map(([value, text]) => element("option", { value, text, selected: value === ban.style })));
        const icon = element("input", { type: "text", id: "ban-icon", maxlength: "8", value: ban.icon, placeholder: "None" });
        const showEnd = element("input", { type: "checkbox", checked: ban.showEnd });
        const showBy = element("input", { type: "checkbox", checked: ban.showBy });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const preview = element("div", { className: "wiki-ban-preview" });

        function endTime() {
            if (length.value === "keep") return Date.parse(current.until);
            if (length.value === "custom") return Date.parse(custom.value) || 0;
            return Date.now() + Number(length.value);
        }

        // Switching the type swaps in that type's wording, unless the admin has already written their own
        let shownType = type.value;
        function switchType() {
            const was = defaultsFor(shownType);
            const now = defaultsFor(type.value);
            if (title.value.trim() === was.title) title.value = now.title;
            if (message.value.trim() === was.message) message.value = now.message;
            if (icon.value.trim() === was.icon) icon.value = now.icon;
            if (style.value === was.style) style.value = now.style;
            shownType = type.value;
        }

        function draft() {
            const until = endTime();
            return {
                type: type.value === "restrain" ? "restrain" : "ban",
                name: account.name,
                until: until ? new Date(until).toISOString() : "",
                title: title.value.trim() || defaultsFor(type.value).title,
                message: message.value.trim(),
                style: style.value,
                icon: icon.value.trim(),
                showEnd: showEnd.checked,
                showBy: showBy.checked,
                by: me
            };
        }

        function update() {
            if (type.value !== shownType) switchType();
            const restraint = type.value === "restrain";
            custom.hidden = length.value !== "custom";
            heading.textContent = current
                ? `Change the ${isRestraint(current) ? "restraining order on" : "ban of"} ${account.name}`
                : restraint ? `Restraining order on ${account.name}` : `Ban ${account.name}`;
            hint.textContent = restraint
                ? `${account.name} sees this message once, the next time they open the wiki. Until it ends, their account works like a reviewer's: their changes wait for an admin or editor to approve them. It ends by itself.`
                : `While the ban lasts, ${account.name} sees only this message on every wiki page, on this account and on any device they last used it on. It ends by itself.`;
            saveButton.textContent = current ? "Save" : restraint ? "Restrain" : "Ban";
            const shown = draft();
            if (!shown.until) shown.until = new Date(Date.now() + 864e5).toISOString();
            preview.className = `wiki-ban-preview wiki-ban-screen-${shown.style}`;
            preview.replaceChildren(store.banBox(shown));
        }

        dialog.append(
            element("button", { type: "button", className: "wiki-dialog-close", "aria-label": "Close", title: "Close (Esc)", text: "×", onclick: close }),
            heading,
            hint,
            element("label", { for: "ban-type", text: "Type" }), type,
            element("label", { for: "ban-length", text: "How long" }), length, custom,
            element("label", { for: "ban-title", text: "Title" }), title,
            element("label", { for: "ban-message", text: "Message" }), message,
            element("div", { className: "wiki-ban-options" },
                element("span", {}, element("label", { for: "ban-style", text: "Look" }), style),
                element("span", {}, element("label", { for: "ban-icon", text: "Icon" }), icon)),
            element("label", { className: "wiki-checkbox" }, showEnd, " Show when it ends"),
            element("label", { className: "wiki-checkbox" }, showBy, " Show who did it"),
            element("p", { className: "wiki-ban-preview-label", text: "Preview" }),
            preview,
            error,
            element("div", { className: "wiki-dialog-actions" },
                element("button", { type: "button", text: "Cancel", onclick: close }),
                saveButton));
        saveButton.addEventListener("click", () => {
            const saved = draft();
            if (!saved.until || Date.parse(saved.until) <= Date.now()) {
                error.textContent = "Pick a time in the future for it to end.";
                return;
            }
            const restraint = isRestraint(saved);
            // Changing the type counts as a new order, so a new restraining order alerts them again
            const same = current && isRestraint(current) === restraint;
            saved.date = same && current.date ? current.date : new Date().toISOString();
            close();
            saveBans((list) => { list[key] = saved; },
                same
                    ? restraint ? `${me} changes the restraining order on ${account.name}` : `${me} changes the ban of ${account.name}`
                    : restraint ? `${me} puts a restraining order on ${account.name} until ${formatTime(saved.until)}` : `${me} bans ${account.name} until ${formatTime(saved.until)}`,
                restraint
                    ? `${account.name} is in reviewer mode until ${formatTime(saved.until)}. They'll be alerted the next time they open the wiki.`
                    : `${account.name} is banned until ${formatTime(saved.until)}. It can take a minute to reach them.`);
        });
        dialog.addEventListener("input", update);
        dialog.addEventListener("change", update);
        dialog.addEventListener("close", () => dialog.remove());
        dialog.addEventListener("click", (event) => {
            const box = dialog.getBoundingClientRect();
            if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
        });
        update();
        document.body.append(dialog);
        dialog.showModal();
        title.focus();
    }

    function banCell(key, account, self) {
        if (self) return element("span", { className: "idea-meta", text: "You can't ban yourself" });
        const ban = activeBan(key);
        return ban
            ? element("span", {},
                element("button", { type: "button", text: "Change", onclick: () => openBanDialog(key) }),
                element("button", { type: "button", text: isRestraint(ban) ? "Lift order" : "Unban", onclick: () => unban(key) }))
            : element("span", {},
                element("button", { type: "button", className: "admin-ban-button", text: "Ban…", onclick: () => openBanDialog(key, "ban") }),
                element("button", { type: "button", className: "admin-restrain-button", text: "Restrain…", onclick: () => openBanDialog(key, "restrain") }));
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
                element("td", {}, activeBan(key)
                    ? element("span", { className: "admin-blocked", text: isRestraint(activeBan(key))
                        ? `Restraining order until ${formatTime(activeBan(key).until)} (reviewer mode)`
                        : `Banned until ${formatTime(activeBan(key).until)}` })
                    : blocked ? element("span", { className: "admin-blocked", text: `Blocked until ${formatTime(account.blockedUntil)}` }) : "Active"),
                element("td", { className: "admin-actions" }, role !== "reviewer"
                    ? element("span", { className: "idea-meta", text: "Only reviewers can be blocked" })
                    : blocked
                        ? element("button", { type: "button", text: "Unblock", onclick: () => unblock(key) })
                        : element("span", {},
                            element("button", { type: "button", text: "1 day", onclick: () => block(key, Date.now() + 864e5) }),
                            element("button", { type: "button", text: "1 week", onclick: () => block(key, Date.now() + 7 * 864e5) }),
                            custom,
                            element("button", { type: "button", text: "Block until", onclick: () => block(key, custom.value) }))),
                element("td", { className: "admin-actions" }, banCell(key, account, self)));
        });
        return element("section", { className: "admin-section" },
            element("h2", { text: "Accounts" }),
            rows.length
                ? element("div", { className: "admin-table-wrap" }, element("table", { className: "admin-table" },
                    element("thead", {}, element("tr", {}, ...["Account", "Role", "Registered", "Email", "Status", "Block", "Ban or restrain"].map((text) => element("th", { text })))),
                    element("tbody", {}, ...rows)))
                : element("p", { text: "No accounts yet." }),
            element("p", { className: "wiki-dialog-hint", text: "Admins: everything goes live, approve reviews, use this panel. Editors: everything goes live, approve reviews. Reviewers: votes count straight away, other changes wait for an admin or editor, can't start threads, new pages are [draft] pages. Blocked reviewers can't log in or save until the block ends. Banned accounts (any role) can't open the wiki at all until the ban ends; they see your message instead. Accounts under a restraining order see your message once, then work like reviewers until it ends." }));
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

    Promise.all(store.isAdmin() ? [store.readAccounts(), store.hasReviewPassword(), renderQueue(), store.readEmailConfig(), store.readBans()] : [{}, false, renderQueue(), null, {}]).then(([data, reviewSet, queueSection, emailConfig, banList]) => {
        accounts = data.accounts || {};
        bans = banList || {};
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
