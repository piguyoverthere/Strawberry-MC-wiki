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

    // Moderation -----------------------------------------------------------------------------
    // A warning shows the admin's message once. A ban hides the whole wiki from that account until it ends, showing
    // the admin's message instead. A restraining order alerts the account, then keeps it in reviewer mode until it ends.
    // Every one of them goes in the account's record, with an optional note, and stays there after it ends.
    let bans = {};
    let record = {};
    let appeals = [];
    // Answered here; the live site can list them for another minute
    const answeredAppeals = new Set();
    const activeBan = (key) => bans[key] && Date.parse(bans[key].until) > Date.now() ? bans[key] : null;
    const isRestraint = (entry) => entry?.type === "restrain";
    const defaultsFor = (type) => type === "restrain" ? store.restraintDefaults : type === "warn" ? store.warningDefaults : store.banDefaults;
    const kindName = (type) => type === "restrain" ? "restraining order" : type === "warn" ? "warning" : "ban";
    const banLengths = [["3600000", "1 hour"], ["86400000", "1 day"], ["259200000", "3 days"], ["604800000", "1 week"], ["2592000000", "30 days"], ["custom", "Until a date…"]];

    function keepModeration(data) {
        bans = data.bans || {};
        record = data.record || {};
    }

    async function saveBans(apply, message, done) {
        status.textContent = "Saving…";
        try {
            keepModeration(await store.updateBans(apply, message));
            status.textContent = done;
        } catch (error) {
            status.textContent = `Could not save: ${error.message}`;
        }
        render();
    }

    // The record entry for the ban or order now in force
    function recordEntry(data, key, ban) {
        return (data.record[key] || []).find((item) => item.type === ban?.type && item.date === ban?.date);
    }

    function addToRecord(data, key, item) {
        data.record[key] = data.record[key] || [];
        data.record[key].push(item);
    }

    function unban(key) {
        const name = accounts[key]?.name || bans[key]?.name || key;
        const restraint = isRestraint(bans[key]);
        saveBans((list, data) => {
            if (!list[key]) return false;
            const item = recordEntry(data, key, list[key]);
            if (item) Object.assign(item, { ended: new Date().toISOString(), endedBy: me });
            delete list[key];
        }, restraint ? `${me} lifts the restraining order on ${name}` : `${me} unbans ${name}`,
        restraint ? `The restraining order on ${name} is lifted.` : `${name} is unbanned. It can take a minute before the wiki opens for them again.`);
    }

    function openBanDialog(key, startType = "ban") {
        const account = accounts[key];
        const current = activeBan(key);
        const ban = { ...defaultsFor(current?.type || startType), ...(current || {}) };
        const dialog = element("dialog", { className: "wiki-dialog wiki-ban-dialog", "aria-label": `Moderate ${account.name}` });
        const shownTypes = current
            ? [["ban", "Ban: hide the wiki from them"], ["restrain", "Restraining order: alert them, then reviewer mode"]]
            : [["warn", "Warning: show them a message once"], ["restrain", "Restraining order: alert them, then reviewer mode"], ["ban", "Ban: hide the wiki from them"]];
        const startAs = current?.type || startType;
        const type = element("select", { id: "ban-type" },
            ...shownTypes.map(([value, text]) => element("option", { value, text, selected: value === startAs })));
        const heading = element("h2");
        const hint = element("p", { className: "wiki-dialog-hint" });
        const saveButton = element("button", { type: "button", className: "wiki-primary" });
        const close = () => {
            dialog.close();
            dialog.remove();
        };
        const lengthLabel = element("label", { for: "ban-length", text: "How long" });
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
        const showEndLabel = element("label", { className: "wiki-checkbox" });
        const showEnd = element("input", { type: "checkbox", checked: ban.showEnd });
        showEndLabel.append(showEnd, " Show when it ends");
        const showBy = element("input", { type: "checkbox", checked: ban.showBy });
        const note = element("textarea", { id: "ban-note", rows: "2", maxlength: "500" });
        note.value = (current && recordNote(key, current)) || "";
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const preview = element("div", { className: "wiki-ban-preview" });

        function endTime() {
            if (type.value === "warn") return 0;
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
                type: type.value,
                name: account.name,
                ...(type.value === "warn" ? {} : { until: until ? new Date(until).toISOString() : "", showEnd: showEnd.checked }),
                title: title.value.trim() || defaultsFor(type.value).title,
                message: message.value.trim(),
                style: style.value,
                icon: icon.value.trim(),
                showBy: showBy.checked,
                by: me
            };
        }

        function update() {
            if (type.value !== shownType) switchType();
            const kind = type.value;
            lengthLabel.hidden = length.hidden = kind === "warn";
            custom.hidden = kind === "warn" || length.value !== "custom";
            showEndLabel.hidden = kind === "warn";
            heading.textContent = current
                ? `Change the ${kindName(current.type)} ${isRestraint(current) ? "on" : "of"} ${account.name}`
                : kind === "warn" ? `Warn ${account.name}` : kind === "restrain" ? `Restraining order on ${account.name}` : `Ban ${account.name}`;
            hint.textContent = kind === "warn"
                ? `${account.name} sees this message once, the next time they open the wiki. Nothing else changes for them.`
                : kind === "restrain"
                    ? `${account.name} sees this message once, the next time they open the wiki. Until it ends, their account works like a reviewer's: their changes wait for an admin or editor to approve them. They can appeal it. It ends by itself.`
                    : `While the ban lasts, ${account.name} sees only this message on every wiki page, on this account and on any device they last used it on. They can appeal it. It ends by itself.`;
            saveButton.textContent = current ? "Save" : kind === "warn" ? "Send warning" : kind === "restrain" ? "Restrain" : "Ban";
            const shown = draft();
            if (!shown.until && kind !== "warn") shown.until = new Date(Date.now() + 864e5).toISOString();
            preview.className = `wiki-ban-preview wiki-ban-screen-${shown.style}`;
            preview.replaceChildren(store.banBox(shown));
        }

        dialog.append(
            element("button", { type: "button", className: "wiki-dialog-close", "aria-label": "Close", title: "Close (Esc)", text: "×", onclick: close }),
            heading,
            hint,
            element("label", { for: "ban-type", text: "Type" }), type,
            lengthLabel, length, custom,
            element("label", { for: "ban-title", text: "Title" }), title,
            element("label", { for: "ban-message", text: "Message" }), message,
            element("div", { className: "wiki-ban-options" },
                element("span", {}, element("label", { for: "ban-style", text: "Look" }), style),
                element("span", {}, element("label", { for: "ban-icon", text: "Icon" }), icon)),
            showEndLabel,
            element("label", { className: "wiki-checkbox" }, showBy, " Show who did it"),
            element("label", { for: "ban-note", text: "Note for the record (optional)" }), note,
            element("p", { className: "wiki-dialog-hint", text: "Why you did it, for other admins. It isn't in the message, but like the rest of the wiki's files it isn't secret." }),
            element("p", { className: "wiki-ban-preview-label", text: "Preview" }),
            preview,
            error,
            element("div", { className: "wiki-dialog-actions" },
                element("button", { type: "button", text: "Cancel", onclick: close }),
                saveButton));
        saveButton.addEventListener("click", () => {
            const saved = draft();
            const kind = saved.type;
            const now = new Date().toISOString();
            const reason = note.value.trim();
            if (kind === "warn") {
                saved.id = `warning-${Date.now().toString(36)}`;
                saved.date = now;
                close();
                saveBans((list, data) => {
                    data.warnings[key] = [...(data.warnings[key] || []), saved];
                    addToRecord(data, key, { type: "warn", title: saved.title, message: saved.message, note: reason, by: me, date: now });
                }, `${me} warns ${account.name}`, `${account.name} will see your warning the next time they open the wiki.`);
                return;
            }
            if (!saved.until || Date.parse(saved.until) <= Date.now()) {
                error.textContent = "Pick a time in the future for it to end.";
                return;
            }
            const restraint = kind === "restrain";
            // Changing the type counts as a new one, so a new restraining order alerts them again
            const same = current && current.type === kind;
            saved.date = same && current.date ? current.date : now;
            if (same && current.appealReply !== undefined) Object.assign(saved, { appealReply: current.appealReply, appealBy: current.appealBy });
            close();
            saveBans((list, data) => {
                const previous = list[key];
                const item = recordEntry(data, key, previous);
                if (same && item) {
                    Object.assign(item, { title: saved.title, message: saved.message, until: saved.until, note: reason });
                } else {
                    if (previous && item && !item.ended) Object.assign(item, { ended: now, endedBy: me });
                    addToRecord(data, key, { type: kind, title: saved.title, message: saved.message, note: reason, until: saved.until, by: me, date: saved.date });
                }
                list[key] = saved;
            },
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

    function recordNote(key, ban) {
        return (record[key] || []).find((item) => item.type === ban.type && item.date === ban.date)?.note || "";
    }

    // Everything an account has been given, newest first
    function openRecord(key) {
        const name = accounts[key]?.name || key;
        const items = [...(record[key] || [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        const dialog = element("dialog", { className: "wiki-dialog wiki-record-dialog", "aria-label": `Record of ${name}` });
        const close = () => dialog.close();
        dialog.append(
            element("button", { type: "button", className: "wiki-dialog-close", "aria-label": "Close", title: "Close (Esc)", text: "×", onclick: close }),
            element("h2", { text: `Record of ${name}` }),
            items.length
                ? element("ol", { className: "wiki-record-list" }, ...items.map((item) => element("li", { className: `wiki-record-${item.type}` },
                    element("strong", { text: `${{ warn: "⚠️ Warning", ban: "⛔ Ban", restrain: "⚖️ Restraining order" }[item.type] || item.type}${item.title && item.title.toLowerCase() !== kindName(item.type) ? `: ${item.title}` : ""}` }),
                    element("span", { className: "idea-meta", text: ` ${formatTime(item.date)} by ${item.by}` }),
                    item.until ? element("div", { text: item.ended
                        ? `Ended early ${formatTime(item.ended)}${item.endedBy ? ` by ${item.endedBy}` : ""} (was until ${formatTime(item.until)})`
                        : Date.parse(item.until) > Date.now() ? `Until ${formatTime(item.until)}` : `Ended ${formatTime(item.until)}` }) : null,
                    item.message ? element("div", { className: "wiki-record-message", text: `Message: ${item.message}` }) : null,
                    item.note ? element("div", { className: "wiki-record-note", text: `Note: ${item.note}` }) : null,
                    item.appeal ? element("div", { className: "wiki-record-note", text: `Appeal: ${item.appeal}` }) : null)))
                : element("p", { text: `${name} has never been warned, banned or restrained.` }),
            element("div", { className: "wiki-dialog-actions" }, element("button", { type: "button", text: "Close", onclick: close })));
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
    }

    function recordSummary(key) {
        const items = record[key] || [];
        if (!items.length) return null;
        const count = (type) => items.filter((item) => item.type === type).length;
        const parts = [["warn", "warning"], ["restrain", "order"], ["ban", "ban"]]
            .map(([type, word]) => [count(type), word]).filter(([n]) => n).map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
        return element("button", { type: "button", className: "wiki-link-button admin-record-link", text: `Record: ${parts.join(", ")}`, onclick: () => openRecord(key) });
    }

    function banCell(key, account, self) {
        if (self) return element("span", { className: "idea-meta", text: "You can't moderate yourself" });
        const ban = activeBan(key);
        return ban
            ? element("span", {},
                element("button", { type: "button", text: "Change", onclick: () => openBanDialog(key) }),
                element("button", { type: "button", text: isRestraint(ban) ? "Lift order" : "Unban", onclick: () => unban(key) }))
            : element("span", {},
                element("button", { type: "button", className: "admin-warn-button", text: "Warn…", onclick: () => openBanDialog(key, "warn") }),
                element("button", { type: "button", className: "admin-restrain-button", text: "Restrain…", onclick: () => openBanDialog(key, "restrain") }),
                element("button", { type: "button", className: "admin-ban-button", text: "Ban…", onclick: () => openBanDialog(key, "ban") }));
    }

    // Appeals wait here until an admin lifts the ban or order, or turns the appeal down with a reply
    async function answerAppeal(appeal, approve, reply = "") {
        const name = appeal.name;
        const what = kindName(appeal.type);
        status.textContent = "Saving…";
        try {
            keepModeration(await store.updateBans((list, data) => {
                const ban = list[appeal.key];
                const current = ban && ban.date === appeal.banDate ? ban : null;
                const item = current && recordEntry(data, appeal.key, current);
                if (approve) {
                    if (item) Object.assign(item, { ended: new Date().toISOString(), endedBy: me, appeal: `lifted by ${me}: “${appeal.message}”` });
                    if (current) delete list[appeal.key];
                } else if (current) {
                    Object.assign(current, { appealReply: reply, appealBy: me });
                    if (item) item.appeal = `turned down by ${me}: “${appeal.message}”${reply ? ` (reply: “${reply}”)` : ""}`;
                }
                if (!current) return false;
            }, approve ? `${me} lifts the ${what} on ${name} after an appeal` : `${me} turns down the appeal of ${name}`));
            await store.updateJson(store.appealsFile, (data) => {
                const before = (data.appeals || []).length;
                data.appeals = (data.appeals || []).filter((item) => item.id !== appeal.id);
                if (data.appeals.length === before) return false;
            }, `Remove answered appeal of ${name}`);
            answeredAppeals.add(appeal.id);
            appeals = appeals.filter((item) => item.id !== appeal.id);
            status.textContent = approve ? `The ${what} on ${name} is lifted.` : `${name}'s appeal is turned down. They'll see your reply.`;
        } catch (error) {
            status.textContent = `Could not save: ${error.message}`;
        }
        queue = await renderQueue();
        render();
    }

    function renderAppeals() {
        if (!store.isAdmin() || !appeals.length) return null;
        return element("section", { className: "admin-section admin-appeals" },
            element("h2", { text: `Appeals (${appeals.length})` }),
            element("p", { className: "wiki-dialog-hint", text: "Banned and restrained accounts can send one appeal each. Lift it, or turn it down with a reply they'll see." }),
            element("ul", {}, ...appeals.map((appeal) => {
                const reply = element("input", { type: "text", maxlength: "300", placeholder: "Reply (optional)", "aria-label": `Reply to ${appeal.name}` });
                return element("li", {},
                    element("strong", { text: `${appeal.name} appeals their ${kindName(appeal.type)}` }),
                    element("span", { className: "idea-meta", text: ` ${formatTime(appeal.date)}, ${appeal.until ? `ends ${formatTime(appeal.until)}` : ""}` }),
                    element("blockquote", { className: "admin-appeal-text", text: appeal.message }),
                    element("span", { className: "admin-actions admin-appeal-actions" },
                        element("button", { type: "button", text: `Lift the ${kindName(appeal.type)}`, onclick: () => answerAppeal(appeal, true) }),
                        reply,
                        element("button", { type: "button", text: "Turn down", onclick: () => answerAppeal(appeal, false, reply.value.trim()) }),
                        recordSummary(appeal.key)));
            })));
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
                    : blocked ? element("span", { className: "admin-blocked", text: `Blocked until ${formatTime(account.blockedUntil)}` }) : "Active",
                    recordSummary(key) ? element("br") : null, recordSummary(key)),
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
                    element("thead", {}, element("tr", {}, ...["Account", "Role", "Registered", "Email", "Status", "Block", "Warn, restrain or ban"].map((text) => element("th", { text })))),
                    element("tbody", {}, ...rows)))
                : element("p", { text: "No accounts yet." }),
            element("p", { className: "wiki-dialog-hint", text: "Admins: everything goes live, approve reviews, use this panel. Editors: everything goes live, approve reviews. Reviewers: votes count straight away, other changes wait for an admin or editor, can't start threads, new pages are [draft] pages. Blocked reviewers can't log in or save until the block ends. Banned accounts (any role) can't open the wiki at all until the ban ends; they see your message instead. Accounts under a restraining order see your message once, then work like reviewers until it ends. A warning is just a message they see once. Banned and restrained accounts can send one appeal, which shows up under Waiting for review. The record keeps every warning, ban and order." }));
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
        const [ideas, bugs, pages, annotations, restores, appealData] = await Promise.all([json("controversy.json"), json("bugs.json"), json("pending-pages.json"), json("annotations.json"), json("restore-requests.json"), json(store.appealsFile)]);
        appeals = (appealData.appeals || []).filter((appeal) => !answeredAppeals.has(appeal.id));
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
        app.replaceChildren(...(store.isAdmin() ? [status, queue, renderAppeals(), renderResetRequests(), renderAccounts(), wikiPasswordSection, reviewSection, emailSection] : [status, queue]));
    }

    Promise.all(store.isAdmin() ? [store.readAccounts(), store.hasReviewPassword(), renderQueue(), store.readEmailConfig(), store.readBans()] : [{}, false, renderQueue(), null, {}]).then(([data, reviewSet, queueSection, emailConfig, banList]) => {
        accounts = data.accounts || {};
        keepModeration(banList || {});
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
