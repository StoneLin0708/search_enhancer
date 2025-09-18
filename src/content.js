// Search Enhancer - Chrome extension
// SPDX-License-Identifier: GPL-3.0-only
// https://github.com/StoneLin0708/search_enhancer

(() => {
    "use strict";

    const PATHS = {
        dots: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
        star: "M235.5 471C235.5 438.423 229.22 407.807 216.66 379.155C204.492 350.503 187.811 325.579 166.616 304.384C145.421 283.189 120.498 266.508 91.845 254.34C63.1925 241.78 32.5775 235.5 0 235.5C32.5775 235.5 63.1925 229.416 91.845 217.249C120.498 204.689 145.421 187.811 166.616 166.616C187.811 145.421 204.492 120.497 216.66 91.845C229.22 63.1925 235.5 32.5775 235.5 0C235.5 32.5775 241.584 63.1925 253.751 91.845C266.311 120.497 283.189 145.421 304.384 166.616C325.579 187.811 350.503 204.689 379.155 217.249C407.807 229.416 438.423 235.5 471 235.5C438.423 235.5 407.807 241.78 379.155 254.34C350.503 266.508 325.579 283.189 304.384 304.384C283.189 325.579 266.311 350.503 253.751 379.155C241.584 407.807 235.5 438.423 235.5 471Z",
    };

    let debug_mode = false;
    let disable = false;

    chrome.storage?.local
        .get(["debug_mode", "disable"])
        .then((result) => {
            if (result.debug_mode !== undefined) {
                debug_mode = result.debug_mode;
            }
            if (result.disable !== undefined) {
                disable = result.disable;
            }
        })
        .catch(() => {
            // Storage not available, use default
        });

    function walk_dom(node) {
        const results = [];
        for (const child of node.children) {
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "path") {
                const d = child.getAttribute("d");
                if (d === PATHS.dots) {
                    results.push({ child, type: "three_dot" });
                } else if (d === PATHS.star) {
                    results.push({ child, type: "star" });
                }
            } else {
                const res = walk_dom(child);
                if (res !== null) {
                    results.push({ ...res, parent: child });
                }
            }
        }
        if (results.length == 0) {
            return null;
        } else if (results.length == 1) {
            return { ...results[0], parent: node };
        } else {
            return { nodes: results, parent: node };
        }
    }

    function merge_ai_overview_nodes(tree) {
        if (tree.hasOwnProperty("nodes")) {
            let star_leaf = tree.nodes.find((n) => n.type === "star");
            if (star_leaf) {
                return { parent: tree.parent, child: star_leaf.child, type: "ai_overview" };
            }
            const nodes = tree.nodes.map(merge_ai_overview_nodes);
            if (nodes.length > 1) {
                return { ...tree, nodes };
            } else if (nodes.length === 1) {
                return nodes[0];
            }
        }
        return tree;
    }

    function highlight_tree(tree) {
        if (tree.hasOwnProperty("type")) {
            if (tree.type === "three_dot") {
                tree.child.parentElement.style.outline = "1px solid #00ff00";
            } else if (tree.type === "star") {
                tree.child.parentElement.style.outline = "1px solid #ff00ff";
            }
            tree.child.style.outlineOffset = "2px";
        } else if (tree.hasOwnProperty("nodes")) {
            if (debug_mode) console.log("Highlighting tree:", tree);
            for (const child of tree.parent.children) {
                child.style.outline = "1px solid #0000ff";
                child.style.outlineOffset = "2px";
            }
            for (const node of tree.nodes) {
                highlight_tree(node);
            }
        }
    }

    function scan_and_remove_ai_overview(tree) {
        const find_in_tree = (node) => {
            if (node.hasOwnProperty("type") && node.type === "ai_overview") {
                return true;
            } else if (node.hasOwnProperty("nodes")) {
                return node.nodes.some(find_in_tree);
            }
            return false;
        };
        for (const node of tree.nodes) {
            if (debug_mode) console.log("Scanning node:", node);
            if (find_in_tree(node)) {
                // check if search form exists to avoid false positive
                if (node.parent.querySelector("form[action='/search']") !== null) {
                    if (debug_mode)
                        console.log("Search form found, skipping removal:", node.parent);
                    return null;
                }

                if (node.parent && node.parent.style !== undefined) {
                    if (debug_mode) console.log("Removing AI Overview element:", node.parent);
                    node.parent.style.display = "none";
                    return node.parent;
                } else {
                    return null;
                }
            }
        }
        return null;
    }

    function search_and_remove() {
        const root = document.body.querySelector("#main");
        if (!root) root = document.body;
        let tree = walk_dom(root);
        if (tree === null || !tree.hasOwnProperty("nodes")) return { tree };
        if (debug_mode) console.log("Initial tree:", tree);
        tree = merge_ai_overview_nodes(tree);
        if (debug_mode) console.log("Merged tree:", tree);
        if (tree === null || !tree.hasOwnProperty("nodes")) return { tree };
        if (debug_mode) highlight_tree(tree);
        if (!disable) {
            const res = scan_and_remove_ai_overview(tree);
            if (res) {
                if (debug_mode) console.log("AI Overview removed:", res);
                return { disabled: res, tree };
            } else {
                if (debug_mode) console.log("No AI Overview found");
                return { tree };
            }
        }
        if (debug_mode) console.log("Disable is on, not removing");
        return { disabled: null, tree };
    }

    function get_search_and_remove() {
        // run until found disabled key or the last_state not changed for a while

        let last_state = null;
        let last_state_time = Date.now();
        return () => {
            const result = search_and_remove();
            if (result.hasOwnProperty("disabled")) return true;
            const compare_trees = (tree1, tree2) => {
                if (tree1 === null && tree2 === null) return true;
                if (tree1 === null || tree2 === null) return false;
                if (!tree1.hasOwnProperty("nodes") && !tree2.hasOwnProperty("nodes"))
                    return tree1.child === tree2.child;
                if (tree1.hasOwnProperty("nodes") && tree2.hasOwnProperty("nodes")) {
                    if (tree1.nodes.length !== tree2.nodes.length) return false;
                    for (let i = 0; i < tree1.nodes.length; i++) {
                        if (!compare_trees(tree1.nodes[i], tree2.nodes[i])) return false;
                    }
                    return true;
                } else {
                    return false;
                }
            };
            if (!compare_trees(result.tree, last_state)) {
                if (debug_mode) console.log("State changed, updating last_state");
                last_state = result.tree;
                last_state_time = Date.now();
                return false;
            } else {
                if (Date.now() - last_state_time > 500) {
                    if (debug_mode) console.log("State stable, stopping further checks");
                    return true;
                } else {
                    if (debug_mode) console.log("State not stable yet, continue checking");
                    return false;
                }
            }
        };
    }

    function observe_changes() {
        const search_and_remove_instance = get_search_and_remove();

        let timeout = null;
        let interval = null;
        let observer = null;

        const cleanup_interval = () => {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
        };

        const start_interval = () => {
            if (interval) return;

            interval = setInterval(() => {
                if (search_and_remove_instance()) {
                    if (debug_mode) console.log("Timer: DOM stable or resolved");
                    cleanup_interval();
                } else if (debug_mode) {
                    console.log("Timer: Continue checking");
                }
            }, 50);
        };

        // trigger interval on DOM changes
        observer = new MutationObserver(() => {
            if (timeout) clearTimeout(timeout);

            timeout = setTimeout(() => {
                start_interval();
            }, 100);
        });

        const search_container = document.body.querySelector("#main");
        if (search_container) {
            observer.observe(search_container, {
                childList: true,
                subtree: true,
            });
        } else {
            if (debug_mode) console.log("Search container not found, starting timer only");
            start_interval();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", observe_changes);
    } else {
        observe_changes();
    }

    chrome.runtime?.onMessage.addListener((msg, sender, send_response) => {
        switch (msg.type) {
            case "set_highlight":
                debug_mode = msg.value;
                chrome.storage?.local.set({ debug_mode }).catch(() => {});
                search_and_remove();
                send_response({ debug_mode });
                break;

            case "set_disable":
                disable = msg.value;
                chrome.storage?.local.set({ disable }).catch(() => {});
                search_and_remove();
                send_response({ disable });
                break;

            case "get_status":
                send_response({
                    debug_mode,
                    disable,
                });
                break;
        }
        return true;
    });
})();
