(() => {
    const app = document.querySelector("#login-app");
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

    // Only go back to a page on this site
    const requested = new URLSearchParams(location.search).get("next") || "";
    const next = /^[\w.-]+\.html(?:[?#].*)?$/.test(requested) && !requested.startsWith("login.html") ? requested : "";

    function field(label, input, hint) {
        return element("div", { className: "login-field" },
            element("label", { for: input.id, text: label }), input,
            hint ? element("p", { className: "wiki-dialog-hint", text: hint }) : null);
    }

    const roleText = {
        admin: "You're an admin: everything you do goes live, you approve reviewers' changes, and you have the admin control panel.",
        editor: "You're an editor: everything you do goes live straight away, and you approve reviewers' changes.",
        reviewer: "You're a reviewer: your votes count straight away, but your comments, ideas, bug reports and page edits show in red until an admin or editor approves them. You can reply in threads but not start new ones, and new pages you make are [draft] pages."
    };

    function renderSignedIn(name) {
        const role = store.getRole();
        app.replaceChildren(element("div", { className: "login-card" },
            element("h2", { text: `Signed in as ${name}` }),
            element("p", {}, element("span", { className: `idea-badge role-badge role-${role}` }, role), " ", roleText[role] || ""),
            role === "admin" ? element("p", {}, element("a", { href: "admin.html" }, "Open the admin control panel")) : null,
            element("p", { className: "login-actions" },
                next ? element("a", { className: "wiki-primary-button", href: next }, "Go back") : null,
                element("a", { href: "ideas.html" }, "Ideas"), " · ",
                element("a", { href: "discussions.html" }, "Threads & Debates"), " · ",
                element("a", { href: "bugs.html" }, "Bug Tracker")),
            element("button", {
                type: "button", className: "wiki-link-button",
                onclick: () => { store.signOut(); location.reload(); }
            }, "Sign out")));
    }

    function finish(name) {
        if (next) {
            location.href = next;
        } else {
            location.reload();
        }
        renderSignedIn(name);
    }

    // After logging in with a temporary password from an admin, choose your own
    function renderNewPassword(name, intro) {
        const personal = element("input", { id: "login-new-password", type: "password", required: true, minlength: 6, autocomplete: "new-password" });
        const confirm = element("input", { id: "login-new-confirm", type: "password", required: true, autocomplete: "new-password" });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary-button" }, "Save new password");
        const form = element("form", { className: "login-card" },
            element("p", { text: intro }),
            field("New personal password", personal, "At least 6 characters. Only you should know it."),
            field("Type it again", confirm),
            error,
            element("p", { className: "login-actions" }, submit));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            error.textContent = "";
            if (personal.value !== confirm.value) {
                error.textContent = "The two passwords don't match.";
                return;
            }
            submit.disabled = true;
            try {
                await store.changePersonalPassword(personal.value);
                finish(name);
            } catch (failure) {
                error.textContent = failure.message;
                submit.disabled = false;
            }
        });
        app.replaceChildren(form);
        document.querySelector("h1").textContent = "Choose a new password";
        personal.focus();
    }

    // After registering with an email address: type in the code that was sent to it
    function renderEmailCode(name, email) {
        const code = element("input", { id: "login-email-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary-button" }, "Confirm email");
        const form = element("form", { className: "login-card" },
            element("p", { text: `Your account is ready. We sent a 6-digit code to ${email} (check your spam folder too). Type it in to confirm the address, so you can reset your personal password if you forget it.` }),
            field("Code", code),
            error,
            element("p", { className: "login-actions" }, submit,
                element("button", { type: "button", className: "wiki-link-button", onclick: () => finish(name) }, "Skip for now")));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            error.textContent = "";
            submit.disabled = true;
            try {
                await store.finishEmailConfirm(code.value);
                finish(name);
            } catch (failure) {
                error.textContent = failure.message;
                submit.disabled = false;
            }
        });
        app.replaceChildren(form);
        document.querySelector("h1").textContent = "Confirm your email";
        code.focus();
    }

    // Forgot the personal password: a code to the account's email, or a request for an admin
    function renderForgot(emailReady) {
        const name = element("input", { id: "login-name", type: "text", required: true, maxlength: 24, autocomplete: "username" });
        const wikiPassword = element("input", { id: "login-wiki-password", type: "password", required: true, autocomplete: "off" });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const emailButton = emailReady ? element("button", { type: "submit", className: "wiki-primary-button", value: "email" }, "Email me a code") : null;
        const adminButton = element("button", { type: emailReady ? "button" : "submit", className: emailReady ? "wiki-link-button" : "wiki-primary-button", value: "admin" }, "Ask an admin instead");
        const form = element("form", { className: "login-card" },
            element("p", { text: emailReady
                ? "If you confirmed an email address, we'll send a code to it. Otherwise, ask an admin: they'll set a temporary password and tell you it."
                : "Ask an admin: they'll set a temporary password for you and tell you it. You'll choose a new one when you log in with it." }),
            field("Username", name),
            field("Wiki or review password", wikiPassword, "The shared password you registered with. It's needed to reach the accounts list."),
            error,
            element("p", { className: "login-actions" }, emailButton, adminButton,
                element("button", { type: "button", className: "wiki-link-button", onclick: () => renderForms("login") }, "Back to log in")));
        async function askAdmin() {
            error.textContent = "";
            if (!form.reportValidity()) return;
            adminButton.disabled = true;
            try {
                const found = await store.requestPasswordReset(name.value, wikiPassword.value);
                app.replaceChildren(element("div", { className: "login-card" },
                    element("p", { text: `Done. An admin will see that ${found} needs a password reset on the Admin page, set a temporary password and tell you it. You'll choose a new one when you log in with it.` }),
                    element("button", { type: "button", className: "wiki-link-button", onclick: () => renderForms("login") }, "Back to log in")));
            } catch (failure) {
                error.textContent = failure.message;
                adminButton.disabled = false;
            }
        }
        if (emailReady) adminButton.addEventListener("click", askAdmin);
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!emailReady) {
                askAdmin();
                return;
            }
            error.textContent = "";
            emailButton.disabled = true;
            try {
                const sentTo = await store.startPasswordReset(name.value, wikiPassword.value);
                renderResetCode(sentTo);
            } catch (failure) {
                error.textContent = failure.message;
                emailButton.disabled = false;
            }
        });
        app.replaceChildren(form);
        document.querySelector("h1").textContent = "Forgot your password";
        name.focus();
    }

    function renderResetCode(sentTo) {
        const code = element("input", { id: "login-reset-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true });
        const personal = element("input", { id: "login-new-password", type: "password", required: true, minlength: 6, autocomplete: "new-password" });
        const confirm = element("input", { id: "login-new-confirm", type: "password", required: true, autocomplete: "new-password" });
        const remember = element("input", { id: "login-remember", type: "checkbox", checked: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary-button" }, "Set new password");
        const form = element("form", { className: "login-card" },
            element("p", { text: `We sent a 6-digit code to ${sentTo}. It works for 15 minutes; check your spam folder too.` }),
            field("Code", code),
            field("New personal password", personal, "At least 6 characters."),
            field("Type it again", confirm),
            element("label", { className: "wiki-checkbox" }, remember, " Remember me on this device"),
            error,
            element("p", { className: "login-actions" }, submit));
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            error.textContent = "";
            if (personal.value !== confirm.value) {
                error.textContent = "The two passwords don't match.";
                return;
            }
            submit.disabled = true;
            try {
                const signedIn = await store.finishPasswordReset(code.value, personal.value, remember.checked);
                finish(signedIn.name);
            } catch (failure) {
                error.textContent = failure.message;
                submit.disabled = false;
            }
        });
        app.replaceChildren(form);
        code.focus();
    }

    function renderForms(mode) {
        const register = mode === "register";
        const name = element("input", { id: "login-name", type: "text", required: true, maxlength: 24, autocomplete: "username" });
        const wikiPassword = element("input", { id: "login-wiki-password", type: "password", required: true, autocomplete: "off" });
        const personal = element("input", { id: "login-personal-password", type: "password", required: true, minlength: register ? 6 : null, autocomplete: register ? "new-password" : "current-password" });
        const confirm = register ? element("input", { id: "login-confirm", type: "password", required: true, autocomplete: "new-password" }) : null;
        const email = register ? element("input", { id: "login-email", type: "email", maxlength: 254, autocomplete: "email" }) : null;
        const emailField = email ? field("Email address (optional)", email, "Only used to send you a code if you forget your personal password. It's saved locked, never in the public files.") : null;
        if (emailField) {
            emailField.hidden = true;
            store.emailReady().then((ready) => { emailField.hidden = !ready; });
        }
        const remember = element("input", { id: "login-remember", type: "checkbox", checked: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary-button" }, register ? "Register" : "Log in");

        const form = element("form", { className: "login-card" },
            element("div", { className: "login-tabs", role: "tablist" },
                element("button", { type: "button", role: "tab", "aria-selected": String(!register), className: register ? "" : "login-tab-active", onclick: () => renderForms("login") }, "Log in"),
                element("button", { type: "button", role: "tab", "aria-selected": String(register), className: register ? "login-tab-active" : "", onclick: () => renderForms("register") }, "Register")),
            field("Username", name, register ? "2 to 24 characters. This is the name your votes, posts and bug reports are saved under." : null),
            field("Wiki or review password", wikiPassword, register
                ? "Admins and editors use the wiki password. Reviewers use the review password; their changes are checked by an admin or editor before they count."
                : "Admins and editors: the wiki password. Reviewers: the review password."),
            field(register ? "Personal password (choose one)" : "Personal password", personal,
                register ? "At least 6 characters. Only you should know it. Don't reuse a password from another site." : null),
            confirm ? field("Confirm personal password", confirm) : null,
            emailField,
            element("label", { className: "wiki-checkbox" }, remember, " Remember me on this device"),
            element("p", { className: "wiki-dialog-hint" }, "Untick this on a shared computer, and you're signed out when you close the tab."),
            error,
            element("p", { className: "login-actions" }, submit,
                register ? null : element("button", {
                    type: "button", className: "wiki-link-button",
                    onclick: async () => renderForgot(await store.emailReady())
                }, "Forgot your personal password?")));

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            error.textContent = "";
            if (confirm && personal.value !== confirm.value) {
                error.textContent = "The two personal passwords don't match.";
                return;
            }
            submit.disabled = true;
            submit.textContent = register ? "Registering…" : "Checking…";
            try {
                const signedIn = register
                    ? await store.register(name.value, wikiPassword.value, personal.value, remember.checked)
                    : await store.login(name.value, wikiPassword.value, personal.value, remember.checked);
                if (signedIn.mustChangePassword) {
                    renderNewPassword(signedIn.name, "You logged in with a temporary password from an admin. Choose your own personal password now.");
                    return;
                }
                if (email?.value.trim() && !emailField.hidden) {
                    try {
                        await store.startEmailConfirm(email.value);
                        renderEmailCode(signedIn.name, email.value.trim());
                        return;
                    } catch (failure) {
                        window.alert(`Your account is ready, but the email couldn't be sent: ${failure.message} You can add it later with Confirm email in the top bar.`);
                    }
                }
                finish(signedIn.name);
            } catch (failure) {
                error.textContent = failure.message;
                submit.disabled = false;
                submit.textContent = register ? "Register" : "Log in";
            }
        });
        app.replaceChildren(form);
        document.querySelector("h1").textContent = register ? "Register" : "Log in";
        name.focus();
    }

    const current = store.getAuthor();
    if (current) {
        renderSignedIn(current);
    } else {
        renderForms(new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login");
    }
})();
