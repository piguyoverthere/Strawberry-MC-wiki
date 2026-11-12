// Profile pages: profile.html?u=name shows someone's picture, bio, links, pictures, who they follow and what
// they've done on the wiki. Your own profile also has your settings further down: profile, appearance, password
// and password recovery. Profiles are saved in profiles.json.
(() => {
    const app = document.getElementById("profile-app");
    const store = window.wikiStore;
    if (!app || !store) return;

    const imagePath = /^profile-images\/[\w-]+\.(png|jpg|gif|webp)$/;
    const maxLinks = 6;
    const peopleShown = 6;
    const data = { accounts: null, profiles: null, controversy: {}, bugs: {}, annotations: {} };
    // Pictures uploaded in this tab show from memory until the published site has them
    const uploaded = new Map();
    const expanded = new Set();

    function element(tag, options = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(options)) {
            if (key === "className") node.className = value;
            else if (key === "text") node.textContent = value;
            else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
            else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
        }
        node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
        return node;
    }

    function formatDate(value) {
        return value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
    }

    const key = (name) => store.accountKey(name || "");
    const me = () => store.isSignedIn() ? store.getAuthor() : "";
    const wanted = new URLSearchParams(location.search).get("u") || me();
    const profileHref = (name) => `profile.html?${new URLSearchParams({ u: name })}`;
    const profileOf = (name) => data.profiles?.[key(name)] || {};
    const accountOf = (name) => data.accounts?.[key(name)];
    const imageSrc = (path) => uploaded.get(path) || path;

    function avatar(name, size) {
        const picture = profileOf(name).picture;
        if (picture && imagePath.test(picture)) {
            return element("img", { className: `profile-avatar profile-avatar-${size}`, src: imageSrc(picture), alt: "" });
        }
        return element("span", { className: `profile-avatar profile-avatar-${size} profile-avatar-empty`, "aria-hidden": "true" }, (name || "?").trim().charAt(0).toUpperCase());
    }

    // Everything someone has done that the wiki keeps a record of
    function activity(name) {
        const who = key(name);
        const mine = (item, field = "author") => key(item?.[field]) === who;
        const ideas = data.controversy.ideas || [];
        const posts = (data.controversy.discussions || []).flatMap((discussion) => discussion.posts || []);
        const replies = ideas.flatMap((idea) => idea.replies || []);
        const votes = ideas.flatMap((idea) => Object.entries(idea.votes || {}).filter(([voter, vote]) => voter === who || mine(vote, "name")).map(([, vote]) => vote));
        const bugs = data.bugs.bugs || [];
        const comments = (data.annotations.annotations || []).flatMap((annotation) => [annotation, ...(annotation.replies || [])]);
        const items = {
            ideas: ideas.filter((idea) => mine(idea)),
            replies: replies.filter((reply) => mine(reply)),
            votes,
            posts: posts.filter((post) => mine(post)),
            bugs: bugs.filter((bug) => mine(bug, "reporter")),
            bugComments: bugs.flatMap((bug) => bug.comments || []).filter((comment) => mine(comment)),
            pageComments: comments.filter((comment) => mine(comment))
        };
        const dates = Object.values(items).flat().flatMap((item) => [item.date, item.created, item.reported, item.edited])
            .concat(profileOf(name).updated)
            .filter(Boolean)
            .sort();
        return { ...items, lastActive: dates.at(-1) || accountOf(name)?.created };
    }

    function followersOf(name) {
        return Object.entries(data.profiles)
            .filter(([, profile]) => (profile.following || []).includes(key(name)))
            .map(([who, profile]) => accountOf(who)?.name || profile.name || who)
            .filter((who) => accountOf(who));
    }

    function followingOf(name) {
        return (profileOf(name).following || []).map((who) => accountOf(who)?.name).filter(Boolean);
    }

    function isFollowing(name) {
        return Boolean(me()) && (profileOf(me()).following || []).includes(key(name));
    }

    async function save(work, button, done) {
        if (button) button.disabled = true;
        try {
            const saved = await work();
            if (saved?.profiles) data.profiles = saved.profiles;
            if (done) done();
            render();
        } catch (error) {
            alert(error.message);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function followButton(name) {
        if (!me() || key(name) === key(me())) return null;
        const following = isFollowing(name);
        const button = element("button", {
            type: "button",
            className: following ? "profile-follow profile-following" : "profile-follow",
            onclick: () => save(() => store.follow(name, !following), button)
        }, following ? "✓ Following" : `+ Follow ${name}`);
        return button;
    }

    function peopleSection(title, names, id) {
        const shown = expanded.has(id) ? names : names.slice(0, peopleShown);
        return element("section", { className: "profile-people" },
            element("h2", {}, title),
            names.length
                ? element("ul", { className: "profile-people-grid" }, ...shown.map((name) => element("li", {},
                    element("a", { href: profileHref(name) }, avatar(name, "medium")),
                    element("div", {},
                        element("a", { className: "profile-person-name", href: profileHref(name) }, profileOf(name).displayName || name),
                        element("span", { className: "profile-person-detail" }, `💡 ${activity(name).ideas.length}`)))))
                : element("p", { className: "profile-empty" }, "Nobody yet."),
            names.length > peopleShown ? element("button", {
                type: "button",
                className: "profile-view-all",
                onclick: () => {
                    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
                    render();
                }
            }, expanded.has(id) ? "Show fewer" : "View all") : null);
    }

    function picturesSection(name, own) {
        const profile = profileOf(name);
        const images = (profile.images || []).filter((path) => imagePath.test(path));
        if (!images.length && !own) return null;
        const upload = element("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true });
        const addButton = element("button", { type: "button", onclick: () => upload.click() }, "+ Add picture");
        upload.addEventListener("change", () => {
            const file = upload.files[0];
            if (!file) return;
            save(async () => {
                const { path, blob } = await store.uploadProfileImage(file);
                uploaded.set(path, URL.createObjectURL(blob));
                return store.updateProfile((fresh) => {
                    fresh.images = [...(fresh.images || []), path].slice(-24);
                    if (!fresh.picture) fresh.picture = path;
                }, `${me()} adds a picture to their profile`);
            }, addButton);
        });
        return element("section", { className: "profile-pictures" },
            element("h2", {}, "Pictures"),
            images.length ? element("ul", { className: "profile-picture-grid" }, ...images.map((path) => element("li", {},
                element("img", { src: imageSrc(path), alt: `Picture shared by ${name}`, loading: "lazy" }),
                own ? element("div", { className: "profile-picture-actions" },
                    profile.picture === path ? element("span", {}, "Profile picture") : element("button", {
                        type: "button",
                        onclick: (event) => save(() => store.updateProfile((fresh) => {
                            fresh.picture = path;
                        }, `${me()} changes their profile picture`), event.currentTarget)
                    }, "Use as profile picture"),
                    element("button", {
                        type: "button",
                        onclick: (event) => {
                            if (!confirm("Remove this picture?")) return;
                            save(async () => {
                                const saved = await store.updateProfile((fresh) => {
                                    fresh.images = (fresh.images || []).filter((item) => item !== path);
                                    if (fresh.picture === path) delete fresh.picture;
                                }, `${me()} removes a picture from their profile`);
                                await store.deleteProfileImage(path);
                                return saved;
                            }, event.currentTarget);
                        }
                    }, "Remove")) : null))) : element("p", { className: "profile-empty" }, "No pictures yet."),
            own ? element("p", {}, addButton, upload) : null);
    }

    function statRow(icon, label, count, href) {
        const content = [element("span", { className: "profile-stat-icon", "aria-hidden": "true" }, icon), element("span", {}, label), element("span", { className: "profile-stat-count" }, String(count))];
        return element("li", {}, href ? element("a", { href }, ...content) : element("div", {}, ...content));
    }

    function renderProfile(name) {
        const account = accountOf(name);
        const profile = profileOf(name);
        const own = key(name) === key(me());
        const done = activity(name);
        const followers = followersOf(name);
        const following = followingOf(name);
        document.title = `${account.name} | Strawberry MC`;
        const links = (profile.links || []).filter((link) => /^https?:\/\//i.test(link.url || ""));
        // Privacy settings hide parts of a profile from everyone else
        const privacy = own ? {} : profile.privacy || {};
        const favourites = (profile.favouritePages || []).filter((page) => /^[\w-]+\.html$/.test(page.href || ""));
        const bigPicture = profile.picture && imagePath.test(profile.picture)
            ? element("img", { className: "profile-big-picture", src: imageSrc(profile.picture), alt: `${account.name}'s profile picture` })
            : element("div", { className: "profile-big-picture profile-avatar-empty", "aria-hidden": "true" }, account.name.charAt(0).toUpperCase());
        return element("div", { className: "profile-view" },
            element("header", { className: "profile-top" },
                avatar(account.name, "small"),
                element("h1", {}, account.name),
                followButton(account.name),
                own ? element("a", { className: "profile-settings-link", href: "#profile-settings" }, "⚙ Settings") : null),
            element("div", { className: "profile-columns" },
                element("aside", { className: "profile-side" },
                    bigPicture,
                    privacy.hideStats ? null : element("ul", { className: "profile-stats" },
                        statRow("💡", "Ideas", done.ideas.length, "ideas.html"),
                        statRow("💬", "Idea comments", done.replies.length, "ideas.html"),
                        statRow("🗳", "Votes", done.votes.length, "ideas.html"),
                        statRow("🧵", "Thread posts", done.posts.length, "discussions.html"),
                        statRow("🐞", "Bugs reported", done.bugs.length, "bugs.html"),
                        statRow("📝", "Page comments", done.pageComments.length),
                        statRow("👥", "Followers", followers.length))),
                element("div", { className: "profile-main" },
                    element("h2", { className: "profile-display-name" }, profile.displayName || account.name,
                        profile.pronouns ? element("span", { className: "profile-pronouns" }, profile.pronouns) : null),
                    profile.status ? element("p", { className: "profile-status" }, `💭 ${profile.status}`) : null,
                    element("p", { className: "profile-meta" },
                        element("span", {}, `📅 Joined: ${formatDate(account.created) || "before profiles"}`),
                        done.lastActive && !privacy.hideLastActive ? element("span", {}, `🕘 Last active: ${formatDate(done.lastActive)}`) : null,
                        profile.minecraftName ? element("span", {}, `⛏ Minecraft: ${profile.minecraftName}`) : null,
                        element("span", { className: `profile-role profile-role-${account.role || "editor"}` }, account.role || "editor"),
                        ...links.map((link) => element("a", { href: link.url, target: "_blank", rel: "noopener nofollow ugc" }, `🔗 ${link.label || new URL(link.url).hostname}`))),
                    profile.bio ? element("p", { className: "profile-bio" }, profile.bio)
                        : element("p", { className: "profile-empty" }, own ? "You haven't written a bio yet. Add one in Settings below." : "No bio yet."),
                    favourites.length ? element("section", { className: "profile-favourites" },
                        element("h2", {}, "Favourite pages"),
                        element("ul", {}, ...favourites.map((page) => element("li", {}, element("a", { href: page.href }, `⭐ ${page.title}`))))) : null,
                    privacy.hideFollows ? null : peopleSection(`Following ${following.length} ${following.length === 1 ? "person" : "people"}`, following, "following"),
                    privacy.hideFollows ? null : peopleSection(`${followers.length} ${followers.length === 1 ? "follower" : "followers"}`, followers, "followers"),
                    picturesSection(account.name, own),
                    own ? peopleSection("Everyone on the wiki", Object.values(data.accounts).map((item) => item.name).filter((who) => key(who) !== key(me())).sort((a, b) => a.localeCompare(b)), "everyone") : null)));
    }

    // Settings -----------------------------------------------------------------------------------
    function field(label, input, hint) {
        const id = `profile-field-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
        input.id = id;
        return element("div", { className: "profile-field" }, element("label", { for: id }, label), input, hint ? element("small", {}, hint) : null);
    }

    function message() {
        return element("p", { className: "profile-form-message", role: "status" });
    }

    function profileForm() {
        const profile = profileOf(me());
        const displayName = element("input", { type: "text", maxlength: 40, value: profile.displayName || "" });
        const bio = element("textarea", { rows: 4, maxlength: 600 });
        bio.value = profile.bio || "";
        const pronouns = element("input", { type: "text", maxlength: 30, value: profile.pronouns || "", placeholder: "e.g. they/them" });
        const statusLine = element("input", { type: "text", maxlength: 80, value: profile.status || "", placeholder: "e.g. Building the Echo Shrine" });
        const minecraftName = element("input", { type: "text", maxlength: 16, value: profile.minecraftName || "", pattern: "\\w{3,16}" });
        const pageList = element("datalist", { id: "profile-page-list" });
        const favouriteInputs = [0, 1, 2].map((index) => element("input", {
            type: "text", list: "profile-page-list", maxlength: 120, value: profile.favouritePages?.[index]?.title || "",
            "aria-label": `Favourite page ${index + 1}`, placeholder: "Start typing a page name",
            onfocus: () => {
                if (!pageList.children.length && typeof pages !== "undefined") {
                    pageList.append(...pages.filter((page) => /^page-/.test(page.href)).map((page) => element("option", { value: page.title })));
                }
            }
        }));
        const linkRows = element("div", { className: "profile-link-rows" });
        const addLink = (link = {}) => {
            if (linkRows.children.length >= maxLinks) return;
            const row = element("div", { className: "profile-link-row" },
                element("input", { type: "text", placeholder: "Label, e.g. YouTube", maxlength: 40, value: link.label || "", "aria-label": "Link label" }),
                element("input", { type: "url", placeholder: "https://…", maxlength: 300, value: link.url || "", "aria-label": "Link address" }),
                element("button", { type: "button", "aria-label": "Remove link", onclick: () => row.remove() }, "✕"));
            linkRows.append(row);
        };
        (profile.links || []).forEach(addLink);
        const status = message();
        const submit = element("button", { type: "submit", className: "wiki-primary" }, "Save profile");
        return element("form", {
            className: "profile-settings-group",
            onsubmit: (event) => {
                event.preventDefault();
                const links = [...linkRows.children].map((row) => {
                    const [label, url] = row.querySelectorAll("input");
                    return { label: label.value.trim(), url: url.value.trim() };
                }).filter((link) => link.url);
                const bad = links.find((link) => !/^https?:\/\/[^\s]+$/i.test(link.url));
                if (bad) {
                    status.textContent = `"${bad.url}" isn't a web address. Start it with https://`;
                    return;
                }
                if (minecraftName.value.trim() && !/^\w{3,16}$/.test(minecraftName.value.trim())) {
                    status.textContent = "Minecraft usernames are 3 to 16 letters, numbers or underscores.";
                    return;
                }
                const wikiPages = typeof pages !== "undefined" ? pages : [];
                const favouritePages = [];
                for (const input of favouriteInputs) {
                    const title = input.value.trim();
                    if (!title) continue;
                    const page = wikiPages.find((item) => item.title.toLowerCase() === title.toLowerCase())
                        || (profile.favouritePages || []).find((item) => item.title === title);
                    if (!page) {
                        status.textContent = `There's no wiki page called "${title}". Pick one from the list.`;
                        return;
                    }
                    favouritePages.push({ title: page.title, href: page.href });
                }
                save(() => store.updateProfile((fresh) => {
                    fresh.displayName = displayName.value.trim();
                    fresh.bio = bio.value.trim();
                    fresh.links = links;
                    fresh.pronouns = pronouns.value.trim();
                    fresh.status = statusLine.value.trim();
                    fresh.minecraftName = minecraftName.value.trim();
                    fresh.favouritePages = favouritePages;
                    for (const name of ["displayName", "bio", "pronouns", "status", "minecraftName"]) {
                        if (!fresh[name]) delete fresh[name];
                    }
                    if (!links.length) delete fresh.links;
                    if (!favouritePages.length) delete fresh.favouritePages;
                }, `${me()} updates their profile`), submit, () => {
                    status.textContent = "Profile saved. Others see it within a minute.";
                });
            }
        },
        element("h3", { id: "settings-profile" }, "Profile"),
        field("Display name", displayName, "Shown above your bio. Your username stays the same."),
        field("Pronouns", pronouns),
        field("Status", statusLine, "A short line shown under your name."),
        field("Bio", bio, "Plain text, up to 600 characters."),
        field("Minecraft username", minecraftName),
        element("div", { className: "profile-field" }, element("span", { className: "profile-field-label" }, "Favourite pages"), ...favouriteInputs, pageList,
            element("small", {}, "Up to 3 wiki pages shown on your profile.")),
        element("div", { className: "profile-field" }, element("span", { className: "profile-field-label" }, "Links"), linkRows,
            element("button", { type: "button", onclick: () => addLink() }, "+ Add link")),
        status,
        element("div", { className: "profile-form-actions" }, submit));
    }

    // Settings that change how the wiki looks and behaves; they apply straight away and follow you to other devices
    function lookGroup(id, title, ...rows) {
        const status = message();
        const group = element("div", { className: "profile-settings-group" }, element("h3", { id }, title), ...rows.map((row) => row(status)), status);
        return group;
    }

    async function changeLook(change, status) {
        try {
            await store.setLook(change);
            status.textContent = "Saved. It follows you to your other devices.";
        } catch (error) {
            status.textContent = `Changed on this device, but not saved to your profile: ${error.message}`;
        }
    }

    function choices(name, legend, options, fallback, hint) {
        return (status) => {
            const current = store.readLook()[name] || fallback;
            return element("fieldset", {}, element("legend", {}, legend),
                ...options.map(([value, label]) => element("label", { className: "profile-choice" },
                    element("input", { type: "radio", name, value, checked: current === value, onchange: () => changeLook({ [name]: value }, status) }), ` ${label}`)),
                hint ? element("small", { className: "profile-hint" }, hint) : null);
        };
    }

    function toggle(name, label, fallback, hint) {
        return (status) => {
            const saved = store.readLook()[name];
            return element("label", { className: "profile-toggle" },
                element("input", { type: "checkbox", checked: saved === undefined ? fallback : saved, onchange: (event) => changeLook({ [name]: event.target.checked }, status) }),
                element("span", {}, label, hint ? element("small", {}, hint) : null));
        };
    }

    function appearanceGroup() {
        return lookGroup("settings-appearance", "Appearance",
            choices("theme", "Theme", [["light", "☀ Light"], ["dark", "🌙 Dark"], ["system", "💻 Match my device"]], "light"),
            choices("textSize", "Text size", [["normal", "Normal"], ["large", "Large"], ["larger", "Larger"]], "normal"),
            choices("font", "Font", [["sans", "Plain"], ["serif", "Book"], ["readable", "Easy to read"]], "sans"),
            choices("width", "Page width", [["normal", "Normal"], ["wide", "Wide"], ["full", "Full screen"]], "normal"),
            toggle("underlineLinks", "Underline all links", false),
            toggle("reduceMotion", "Reduce motion", false, "Turns off sliding and fading."));
    }

    function readingGroup() {
        return lookGroup("settings-reading", "Reading",
            choices("codeTab", "Code boxes open on", [["Java", "Java"], ["Pseudocode", "Pseudocode"]], "Java"),
            choices("contents", "Contents box on long pages", [["auto", "Open on big screens"], ["open", "Always open"], ["closed", "Always closed"]], "auto"));
    }

    function editingGroup() {
        return lookGroup("settings-editing", "Editing",
            toggle("spellcheck", "Check spelling while editing pages", true));
    }

    function notificationsGroup() {
        return lookGroup("settings-notifications", "Notifications",
            toggle("taskPopups", "Pop up a message when someone pings you", true),
            toggle("headerBadge", "Show the number of tasks for you in the top bar", true),
            choices("notificationsView", "The Notifications page opens on", [["notifications", "Notifications (things for you)"], ["changes", "Changes (everything)"]], "notifications"));
    }

    // Saved in your public profile, so they apply for everyone who looks at it
    function privacyGroup() {
        const privacy = profileOf(me()).privacy || {};
        const status = message();
        const option = (name, label) => element("label", { className: "profile-toggle" },
            element("input", {
                type: "checkbox", checked: Boolean(privacy[name]),
                onchange: (event) => save(() => store.updateProfile((fresh) => {
                    fresh.privacy = { ...fresh.privacy, [name]: event.target.checked };
                    if (!event.target.checked) delete fresh.privacy[name];
                    if (!Object.keys(fresh.privacy).length) delete fresh.privacy;
                }, `${me()} changes their privacy settings`), event.target, () => {
                    status.textContent = "Saved.";
                })
            }), element("span", {}, label));
        return element("div", { className: "profile-settings-group" },
            element("h3", { id: "settings-privacy" }, "Privacy"),
            element("p", { className: "profile-hint" }, "Hides these from other people's view of your profile. The wiki's files are public, so this keeps your profile tidy rather than secret."),
            option("hideStats", "Hide my activity counts"),
            option("hideLastActive", "Hide when I was last active"),
            option("hideFollows", "Hide who I follow and who follows me"),
            status);
    }

    function dataGroup() {
        const status = message();
        const clearLocal = (test, what) => {
            if (!confirm(`Remove ${what} from this device? This can't be undone.`)) return;
            let removed = 0;
            try {
                for (const name of Object.keys(localStorage)) {
                    if (test(name)) {
                        localStorage.removeItem(name);
                        removed++;
                    }
                }
            } catch {
                // Storage blocked; nothing was saved there.
            }
            status.textContent = removed ? `Removed ${what}.` : `There were no ${what} on this device.`;
        };
        return element("div", { className: "profile-settings-group" },
            element("h3", { id: "settings-data" }, "Your data"),
            element("p", { className: "profile-form-actions" },
                element("button", {
                    type: "button",
                    onclick: () => {
                        const account = accountOf(me());
                        const { lastActive, ...items } = activity(me());
                        const file = new Blob([JSON.stringify({
                            account: { name: account.name, role: account.role || "editor", created: account.created },
                            profile: profileOf(me()), lastActive, ...items
                        }, null, 2)], { type: "application/json" });
                        const link = element("a", { href: URL.createObjectURL(file), download: `${key(me()).replace(/[^a-z0-9]+/g, "-")}-strawberry-wiki.json` });
                        link.click();
                        URL.revokeObjectURL(link.href);
                    }
                }, "⬇ Download my data"),
                element("button", { type: "button", onclick: () => clearLocal((name) => name.startsWith("strawberry-wiki-draft:"), "saved page edits") }, "Clear saved page edits"),
                element("button", { type: "button", onclick: () => clearLocal((name) => name.startsWith("strawberry-wiki-bookmarks:"), "bookmarks") }, "Clear bookmarks"),
                element("button", {
                    type: "button",
                    onclick: async () => {
                        if (!confirm("Put every appearance, reading, editing and notification setting back to how it started?")) return;
                        await store.setLook({}, { reset: true }).catch(() => {});
                        location.reload();
                    }
                }, "Reset all settings")),
            element("small", { className: "profile-hint" }, "Your data is everything the wiki keeps about you: your profile, ideas, comments, votes, posts and bug reports. Saved edits and bookmarks are only on this device."),
            status);
    }

    function passwordForm() {
        const current = element("input", { type: "password", autocomplete: "current-password", required: true });
        const next = element("input", { type: "password", autocomplete: "new-password", minlength: 6, required: true });
        const again = element("input", { type: "password", autocomplete: "new-password", minlength: 6, required: true });
        const status = message();
        const submit = element("button", { type: "submit", className: "wiki-primary" }, "Change password");
        const form = element("form", {
            className: "profile-settings-group",
            onsubmit: async (event) => {
                event.preventDefault();
                status.textContent = "";
                if (next.value !== again.value) {
                    status.textContent = "The new passwords don't match.";
                    return;
                }
                submit.disabled = true;
                try {
                    await store.changePersonalPassword(next.value, current.value);
                    form.reset();
                    status.textContent = "Your personal password is changed. Use the new one next time you log in.";
                } catch (error) {
                    status.textContent = error.message;
                } finally {
                    submit.disabled = false;
                }
            }
        },
        element("h3", { id: "settings-password" }, "Personal password"),
        element("p", { className: "profile-hint" }, "This is your own password, not the wiki password everyone shares."),
        field("Current password", current),
        field("New password", next, "At least 6 characters."),
        field("New password again", again),
        status,
        element("div", { className: "profile-form-actions" }, submit));
        return form;
    }

    function recoveryGroup() {
        const group = element("div", { className: "profile-settings-group" }, element("h3", { id: "settings-recovery" }, "Password recovery"), element("p", {}, "Checking…"));
        (async () => {
            let ready = false;
            try {
                ready = await store.emailReady();
            } catch {
                // Treated as not set up.
            }
            const account = accountOf(me());
            const confirmed = account?.emailConfirmed;
            group.replaceChildren(element("h3", { id: "settings-recovery" }, "Password recovery"),
                !ready ? element("p", {}, "Emailed reset codes aren't set up on this wiki yet. If you forget your personal password, use \"Ask an admin\" on the login page.")
                    : element("p", {}, confirmed ? `✓ You confirmed an email address on ${formatDate(confirmed)}. If you forget your personal password, a code is sent there.`
                        : "You haven't added an email address. Without one, only an admin can reset your personal password."),
                ready ? element("button", { type: "button", onclick: () => store.confirmEmail() }, confirmed ? "Change email address" : "✉ Confirm an email address") : null);
        })();
        return group;
    }

    function accountGroup() {
        const account = accountOf(me());
        return element("div", { className: "profile-settings-group" },
            element("h3", { id: "settings-account" }, "Account"),
            element("p", {}, `You're signed in as ${account.name} (${account.role || "editor"}).`),
            element("p", { className: "profile-form-actions" },
                element("a", { className: "profile-plain-button", href: "login.html" }, "Log in as someone else"),
                element("button", { type: "button", onclick: () => {
                    store.signOut();
                    location.href = "home-index.html";
                } }, "Sign out")));
    }

    let settings = null;

    function renderSettings() {
        const groups = [profileForm(), appearanceGroup(), readingGroup(), editingGroup(), notificationsGroup(), privacyGroup(), passwordForm(), recoveryGroup(), dataGroup(), accountGroup()];
        settings = element("section", { id: "profile-settings", className: "profile-settings" },
            element("h2", {}, "⚙ Settings"),
            element("nav", { className: "profile-settings-nav", "aria-label": "Settings sections" },
                ...groups.map((group) => {
                    const heading = group.querySelector("h3");
                    return element("a", { href: `#${heading.id}` }, heading.textContent);
                })),
            element("div", { className: "profile-settings-grid" }, ...groups));
        return settings;
    }

    // Drawing ------------------------------------------------------------------------------------
    const view = element("div");

    function render() {
        if (!data.accounts || !data.profiles) return;
        if (!wanted) {
            app.replaceChildren(element("h1", {}, "Profiles"),
                element("p", {}, element("a", { href: store.loginHref() }, "Log in"), " to see your profile and settings."));
            return;
        }
        if (!accountOf(wanted)) {
            app.replaceChildren(element("h1", {}, "Profile not found"), element("p", {}, `There's no account named "${wanted}".`));
            return;
        }
        if (!view.isConnected) app.replaceChildren(view);
        store.keepInputs([view], () => view.replaceChildren(renderProfile(accountOf(wanted).name)));
        // Settings are drawn once so nothing typed into them is lost when someone else saves
        if (key(wanted) === key(me()) && !settings) {
            app.append(renderSettings());
            if (location.hash === "#profile-settings") settings.scrollIntoView();
        }
    }

    const files = { accounts: "accounts.json", profiles: store.profilesFile, controversy: "controversy.json", bugs: "bugs.json", annotations: "annotations.json" };
    for (const [name, file] of Object.entries(files)) {
        store.watchJson(file, (json) => {
            data[name] = name === "accounts" ? json.accounts || {} : name === "profiles" ? json.profiles || {} : json;
            render();
        });
    }
})();
