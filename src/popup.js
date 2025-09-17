document.addEventListener("DOMContentLoaded", () => {
    const debug_mode_checkbox = document.getElementById("debug_mode");
    const disable_checkbox = document.getElementById("disable");

    async function send_message(message) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes("google.com/search")) {
                return await chrome.tabs.sendMessage(tab.id, message);
            } else {
                return null;
            }
        } catch (error) {
            return null;
        }
    }

    debug_mode_checkbox.addEventListener("change", async (e) => {
        await send_message({
            type: "set_highlight",
            value: e.target.checked,
        });
    });

    disable_checkbox.addEventListener("change", async (e) => {
        await send_message({
            type: "set_disable",
            value: e.target.checked,
        });
    });

    send_message({ type: "get_status" }).then((result) => {
        if (result) {
            debug_mode_checkbox.checked = result.debug_mode;
            disable_checkbox.checked = result.disable;
        }
    });
});
