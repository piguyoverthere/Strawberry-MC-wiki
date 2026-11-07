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
        editor: "You're an editor: everything you do goes live straight away.",
        reviewer: "You're a reviewer: your votes, comments, ideas, bug reports and page edits show in red until an admin approves them. You can reply in threads but not start new ones, and new pages you make are [draft] pages."
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

    function renderForms(mode) {
        const register = mode === "register";
        const name = element("input", { id: "login-name", type: "text", required: true, maxlength: 24, autocomplete: "username" });
        const wikiPassword = element("input", { id: "login-wiki-password", type: "password", required: true, autocomplete: "off" });
        const personal = element("input", { id: "login-personal-password", type: "password", required: true, minlength: register ? 6 : null, autocomplete: register ? "new-password" : "current-password" });
        const confirm = register ? element("input", { id: "login-confirm", type: "password", required: true, autocomplete: "new-password" }) : null;
        const remember = element("input", { id: "login-remember", type: "checkbox", checked: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert" });
        const submit = element("button", { type: "submit", className: "wiki-primary-button" }, register ? "Register" : "Log in");

        const form = element("form", { className: "login-card" },
            element("div", { className: "login-tabs", role: "tablist" },
                element("button", { type: "button", role: "tab", "aria-selected": String(!register), className: register ? "" : "login-tab-active", onclick: () => renderForms("login") }, "Log in"),
                element("button", { type: "button", role: "tab", "aria-selected": String(register), className: register ? "login-tab-active" : "", onclick: () => renderForms("register") }, "Register")),
            field("Username", name, register ? "2 to 24 characters. This is the name your votes, posts and bug reports are saved under." : null),
            field("Wiki or review password", wikiPassword, register
                ? "Admins and editors use the wiki password. Reviewers use the review password; their changes are checked by an admin before they count."
                : "Admins and editors: the wiki password. Reviewers: the review password."),
            field(register ? "Personal password (choose one)" : "Personal password", personal,
                register ? "At least 6 characters. Only you should know it. Don't reuse a password from another site." : null),
            confirm ? field("Confirm personal password", confirm) : null,
            element("label", { className: "wiki-checkbox" }, remember, " Remember me on this device"),
            element("p", { className: "wiki-dialog-hint" }, "Untick this on a shared computer, and you're signed out when you close the tab."),
            error,
            element("p", { className: "login-actions" }, submit));

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
                if (next) {
                    location.href = next;
                } else {
                    location.reload();
                }
                renderSignedIn(signedIn.name);
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
