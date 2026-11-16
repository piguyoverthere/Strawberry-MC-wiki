// Assets page: folders and files kept on the repository's "assets" branch (see unlockAssets in wiki-editor.js).
// The wiki or review password is asked for on every visit and only kept in memory while the page is open.
(() => {
    const app = document.querySelector("#assets-app");
    const store = window.wikiStore;
    if (!app || !store?.unlockAssets) {
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
        node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
        return node;
    }

    let session = null;
    let folder = "";
    let items = [];
    const status = element("p", { className: "assets-status", role: "status" });

    const formatSize = (bytes) => bytes === undefined ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
    const icons = { png: "🖼", jpg: "🖼", jpeg: "🖼", gif: "🖼", webp: "🖼", svg: "🖼", bmp: "🖼", json: "🧾", mcmeta: "🧾", html: "🌐", htm: "🌐", pdf: "📕", doc: "📝", docx: "📝", txt: "📝", md: "📝", xls: "📊", xlsx: "📊", csv: "📊", zip: "🗜", jar: "☕", mp3: "🎵", ogg: "🎵", wav: "🎵", mp4: "🎞" };
    const iconFor = (item) => item.type === "folder" ? "📁" : icons[item.name.split(".").pop().toLowerCase()] || "📄";

    // Password gate ---------------------------------------------------------------------------
    function renderGate(message = "") {
        const input = element("input", { type: "password", id: "assets-password", autocomplete: "current-password", required: true });
        const error = element("p", { className: "wiki-dialog-error", role: "alert", text: message });
        const button = element("button", { type: "submit", className: "wiki-primary-button", text: "Open Assets" });
        const form = element("form", {
            className: "assets-gate",
            onsubmit: async (event) => {
                event.preventDefault();
                button.disabled = true;
                button.textContent = "Checking…";
                error.textContent = "";
                try {
                    session = await store.unlockAssets(input.value);
                    folder = new URLSearchParams(location.hash.slice(1)).get("folder") || "";
                    await open(folder);
                } catch (failure) {
                    error.textContent = /isn't the wiki password/.test(failure.message) ? "That password isn't right." : failure.message;
                    button.disabled = false;
                    button.textContent = "Open Assets";
                    input.select();
                }
            }
        },
        element("h2", { text: "Enter the password" }),
        element("p", { className: "wiki-dialog-hint", text: "Assets needs the wiki password or the review password each time you open it." }),
        element("label", { for: "assets-password", text: "Wiki or review password" }), input, error, button);
        app.replaceChildren(form);
        input.focus();
    }

    // Browsing --------------------------------------------------------------------------------
    async function open(path) {
        status.textContent = "Loading…";
        render();
        try {
            const list = await session.list(path);
            if (list === null) {
                status.textContent = "That folder doesn't exist any more.";
                if (path) return open(path.split("/").slice(0, -1).join("/"));
                items = [];
            } else {
                items = list;
                status.textContent = "";
            }
            folder = path;
            history.replaceState(null, "", path ? `#${new URLSearchParams({ folder: path })}` : location.pathname + location.search);
        } catch (error) {
            status.textContent = `Couldn't load the folder: ${error.message}`;
        }
        render();
    }

    function crumbs() {
        const parts = folder ? folder.split("/") : [];
        const nav = element("nav", { className: "assets-crumbs", "aria-label": "Folder" },
            element("button", { type: "button", className: "wiki-link-button", text: "Assets", onclick: () => open("") }));
        parts.forEach((part, index) => {
            nav.append(element("span", { className: "assets-crumb-separator", text: " / " }));
            const path = parts.slice(0, index + 1).join("/");
            nav.append(index === parts.length - 1
                ? element("strong", { text: part })
                : element("button", { type: "button", className: "wiki-link-button", text: part, onclick: () => open(path) }));
        });
        return nav;
    }

    async function newFolder() {
        const name = window.prompt("Name of the new folder");
        if (!name?.trim()) return;
        status.textContent = "Creating the folder…";
        try {
            await session.createFolder(folder, name.trim());
            await open(folder ? `${folder}/${name.trim()}` : name.trim());
        } catch (error) {
            status.textContent = `Couldn't create it: ${error.message}`;
        }
    }

    async function uploadFiles(files) {
        const list = [...files];
        if (!list.length) return;
        let done = 0;
        for (const file of list) {
            status.textContent = `Uploading ${file.name} (${done + 1} of ${list.length})…`;
            try {
                let result = await session.upload(folder, file);
                if (result.exists) {
                    if (!window.confirm(`${file.name} is already here. Replace it with the new one?`)) continue;
                    result = await session.upload(folder, file, true);
                }
                done++;
            } catch (error) {
                status.textContent = `${file.name} wasn't uploaded: ${error.message}`;
                await open(folder);
                return;
            }
        }
        await open(folder);
        status.textContent = `Uploaded ${done} file${done === 1 ? "" : "s"}.`;
    }

    async function download(item) {
        status.textContent = `Downloading ${item.name}…`;
        try {
            const blob = await session.download(item.path);
            const url = URL.createObjectURL(blob);
            const link = element("a", { href: url, download: item.name });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            status.textContent = "";
        } catch (error) {
            status.textContent = `Couldn't download it: ${error.message}`;
        }
    }

    async function remove(item) {
        if (!window.confirm(item.type === "folder" ? `Delete the empty folder "${item.name}"?` : `Delete ${item.name}? It stays in the repository's history, but leaves this list.`)) return;
        status.textContent = "Deleting…";
        try {
            await session.remove(item);
            await open(folder);
        } catch (error) {
            status.textContent = `Couldn't delete it: ${error.message}`;
        }
    }

    function render() {
        if (!session) return;
        const picker = element("input", { type: "file", multiple: true, hidden: true });
        picker.addEventListener("change", () => uploadFiles(picker.files));
        const drop = element("div", { className: "assets-drop", text: "Drop files here to upload them to this folder" });
        for (const type of ["dragenter", "dragover"]) {
            drop.addEventListener(type, (event) => {
                event.preventDefault();
                drop.classList.add("is-over");
            });
        }
        drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
        drop.addEventListener("drop", (event) => {
            event.preventDefault();
            drop.classList.remove("is-over");
            uploadFiles(event.dataTransfer.files);
        });
        const rows = items.map((item) => element("tr", {},
            element("td", { className: "assets-name" },
                element("span", { className: "assets-icon", "aria-hidden": "true", text: iconFor(item) }),
                item.type === "folder"
                    ? element("button", { type: "button", className: "wiki-link-button", text: item.name, onclick: () => open(item.path) })
                    : element("span", { text: item.name })),
            element("td", { className: "assets-size", text: item.type === "folder" ? "Folder" : formatSize(item.size) }),
            element("td", { className: "assets-actions" },
                item.type === "file" ? element("button", { type: "button", text: "Download", onclick: () => download(item) }) : null,
                session.kind === "wiki" ? element("button", { type: "button", className: "assets-delete", text: "Delete", onclick: () => remove(item) }) : null)));
        app.replaceChildren(
            element("div", { className: "assets-toolbar" },
                crumbs(),
                element("span", { className: "assets-buttons" },
                    element("button", { type: "button", text: "+ New folder", onclick: newFolder }),
                    element("button", { type: "button", className: "wiki-primary-button", text: "Upload files", onclick: () => picker.click() }),
                    picker,
                    element("button", { type: "button", text: "Lock", title: "Close Assets; the password is asked for again", onclick: () => { session = null; renderGate(); } }))),
            status,
            drop,
            rows.length
                ? element("div", { className: "admin-table-wrap" }, element("table", { className: "admin-table assets-table" },
                    element("thead", {}, element("tr", {}, ...["Name", "Size", ""].map((text) => element("th", { text })))),
                    element("tbody", {}, ...rows)))
                : element("p", { className: "assets-empty", text: folder ? "This folder is empty." : "Nothing here yet. Make a folder or upload files." }),
            element("p", { className: "wiki-dialog-hint", text: `Signed in as ${session.who}. Any file type, up to 25 MB each. Files are kept in the repository's "assets" branch, apart from the website, so they don't slow down site updates. Like the rest of the wiki's repository, they can be downloaded by anyone who finds them; they aren't secret.${session.kind === "review" ? " Deleting needs the wiki password." : ""}` }));
    }

    renderGate();
})();
