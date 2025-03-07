interface Element {
    element: HTMLElement,
    itemId: string,
    itemName: string,
    instanceId: number,
    x: number,
    y: number,
};

/*
 * how dropped items work as of 0.117
 *  Item.js defines a class, ItemStack which represents the stack of all
 *          items at one particular location in the world.
 *
 *  Since multiple kinds of string identifier are used, I've come up with some
 *  terms for them. This might not map to genfanad source code, but are used in
 *  genlite.
 *
 *      instanceId - a unique identifier for a specific item on the ground
 *                   e.g: "i1cc50" or "is217-1557e"
 *
 *      itemId - a unique identifier for a kind of item
 *               e.g: "cooking-raw-rat_lq"
 *
 *      itemName - a human readable item name
 *               e.g.: "L.Q. Raw Rat Meat"
 *
 *  Game.js maintains two separate maps of ItemStacks:
 *      GAME.item_stacks maps from a location it's ItemStack
 *      GAME.items maps from an instanceId to it's ItemStack
 *
 *  WorldItem was removed in v0.117
 *
 * This plugin's update loop checks GAME.items for any new item instances,
 * generates UI for displaying their name and setting priorities. It then
 * overrides the ItemStack.intersect method to apply our custom priorities
 * to each item, modifying the left-click and right-click actions order.
*/

import {GenLitePlugin} from '../core/interfaces/plugin.interface';

export class GenLiteItemHighlightPlugin implements GenLitePlugin {
    static pluginName = 'GenLiteItemHighlightPlugin';

    originalItemStackIntersects: Function;

    trackedStacks: string[] = [];
    itemElements: Record<string, Element> = {};

    itemData = {};
    itemHighlightDiv = null;

    render = false;

    isAltDown: boolean = false;
    styleRuleIndex: number = -1

    isPluginEnabled: boolean = false;
    hideLables: boolean = false;

    async init() {
        window.genlite.registerPlugin(this);
        this.originalItemStackIntersects = ItemStack.prototype.intersects;

        this.loadItemList();
        this.createDiv();

        this.isPluginEnabled = window.genlite.settings.add(
            "ItemHighlight.Enable",
            true,
            "Highlight Items",
            "checkbox",
            this.handlePluginEnableDisable,
            this,
            undefined,
            undefined
        );
        this.hideLables = window.genlite.settings.add(
            "HideItemLabels.Enable",
            false,
            "Hide Item Labels",
            "checkbox",
            this.handleHideLabelsEnableDisable,
            this,
            undefined,
            undefined,
            "ItemHighlight.Enable"
        );

        let storedPriorityColor = window.genlite.settings.add("ItemHighlight.PriorityColor", "#ffa500", "Priority Item Color", "color", this.handleColorChange, this, undefined, undefined, "ItemHighlight.Enable");

        let sheet = document.styleSheets[0];
        this.styleRuleIndex = sheet.insertRule(`.genlite-priority-item { color: ${storedPriorityColor}; }`, sheet.cssRules.length);

        window.addEventListener('keydown', this.keyDownHandler.bind(this));
        window.addEventListener('keyup', this.keyUpHandler.bind(this));
        window.addEventListener("blur", this.blurHandler.bind(this))

        if (this.isPluginEnabled === true) {
            ItemStack.prototype.intersects = this.ItemStack_intersects;
        }
    }

    //
    // internal state
    //

    saveItemList() {
        this.clearTracked();
        localStorage.setItem("genliteItemData", JSON.stringify(this.itemData));
    }

    loadItemList() {
        let storedItemData = localStorage.getItem("genliteItemData")
        if (storedItemData !== null) {
            this.itemData = JSON.parse(storedItemData);
        }
    }

    clearTracked() {
        this.itemHighlightDiv.innerHTML = '';
        this.itemElements = {};
        this.trackedStacks = [];
    }

    setDisplayState(state) {
        const hiddenElements = document.querySelectorAll('.genlite-item-setting') as NodeListOf<HTMLElement>;
        hiddenElements.forEach((element) => {
            element.style.display = state;
        });
    }

    //
    // ui
    //

    createDiv() {
        this.itemHighlightDiv = document.createElement('div');
        this.itemHighlightDiv.className = 'item-indicators-list';
        document.body.appendChild(this.itemHighlightDiv);
    }

    createOrUpdateElement(instanceId) {
        let element = this.itemElements[instanceId];
        if (!element) {
            element = this.createElement(instanceId);
        }
        return element;
    }

    createElement(instanceId) {
        let stackable = false;
        let itemStack = GAME.items[instanceId];
        let itemId = itemStack.item_keys[instanceId].item_id;
        let itemName = itemStack.item_info[itemId].name;

        if (itemId.startsWith('$scrip-')) {
            itemId = itemId.substring(7);
            stackable = true;
        } else {
            stackable = DATA.items[itemId].stackable ?? false;
        }

        let div = document.createElement('div');
        div.className = this.getItemColor(itemId);
        div.style.position = 'absolute';
        // afaict quantity info is not available in the new item system
        // if (stackable === true) {
        //     itemName= `${itemName}(${item.definition.quantity})`;
        // }
        div.innerHTML = `<span style="display: inline-block;">${itemName}</span>
                             <div class="genlite-item-setting" style="display: ${this.isAltDown ? "inline-block" : "none"}; pointer-events: auto;" onclick="window.${GenLiteItemHighlightPlugin.pluginName}.hideItem('${itemId}');void(0);"> &#8863;</div>
                             <div class="genlite-item-setting" style="display: ${this.isAltDown ? "inline-block" : "none"}; pointer-events: auto;" onclick="window.${GenLiteItemHighlightPlugin.pluginName}.importantItem('${itemId}');void(0);"> &#8862;</div>`;
        div.style.transform = 'translateX(-50%)';
        div.style.pointerEvents = "none";
        div.style.textShadow = '-1px -1px 0 #000,0   -1px 0 #000, 1px -1px 0 #000, 1px  0   0 #000, 1px  1px 0 #000, 0    1px 0 #000, -1px  1px 0 #000, -1px  0   0 #000';
        this.itemHighlightDiv.appendChild(div);
        let e = {
            element: div,
            itemId: itemId,
            itemName: itemName,
            instanceId: instanceId,
            x: itemStack.location.position.x,
            y: itemStack.location.position.y
        };
        this.itemElements[instanceId] = e;
        return e;
    }

    removeElement(key) {
        this.itemElements[key].element.remove();
        delete this.itemElements[key];
    }

    //
    // event handling
    //

    keyDownHandler(event) {
        if (event.key !== "Alt")
            return;

        event.preventDefault();
        if (!event.repeat) {
            this.isAltDown = true;
            this.setDisplayState("inline-block");
        }
    }
    keyUpHandler(event) {
        if (event.key !== "Alt")
            return;

        event.preventDefault();
        this.isAltDown = false;
        this.setDisplayState("none");
    }

    blurHandler() {
        this.isAltDown = false;
        this.setDisplayState("none");
    }

    loginOK() {
        this.render = true;
    }

    logoutOK() {
        this.render = false;
        this.clearTracked();
    }

    //
    // settings handling
    //

    handlePluginEnableDisable(state: boolean) {
        // when disabling the plugin clear the current list of items
        if (state === false) {
            this.clearTracked();
            ItemStack.prototype.intersects = this.originalItemStackIntersects;
        } else {
            ItemStack.prototype.intersects = this.ItemStack_intersects;
        }

        this.isPluginEnabled = state;
    }

    handleHideLabelsEnableDisable(state: boolean) {
        // no matter what clear the current items to refresh the display
        this.clearTracked();
        this.hideLables = state;
    }

    handleColorChange(value: string) {
        let sheet = document.styleSheets[0] as any;
        sheet.cssRules[this.styleRuleIndex].style.color = value;
    }

    //
    // item utils
    //

    getItemData(itemId) {
        if (!this.itemData.hasOwnProperty(itemId))
            return 0;
        return this.itemData[itemId];
    }

    getItemValue(itemId) {
        let gameValue = DATA.items[itemId].value ?? 1;
        return gameValue;
    }

    getItemColor(itemId) {
        let itemPriority = this.getItemData(itemId);
        if (itemPriority == -1) {
            return "spell-locked";
        } else if (itemPriority == 1) {
            return "genlite-priority-item";
        }
   
        let itemValue = this.getItemValue(itemId);
  
        if (itemValue >= 10000) {
            return 'text-ran';
        } else if (itemValue >= 5000) {
            return 'text-purple';
        } else if (itemValue >= 1000) {
            return 'text-magenta';
        } else if (itemValue >= 500) {
            return 'text-gold';
        } else if (itemValue >= 100) {
            return 'text-limegreen';
        } else {
            return 'text-white';
        }
    }

    hideItem(key) {
        if (!this.itemData.hasOwnProperty(key) || this.itemData[key] != -1) {
            this.itemData[key] = -1;
        } else {
            this.itemData[key] = 0;
        }
        this.saveItemList();
    }

    importantItem(key) {
        if (!this.itemData.hasOwnProperty(key) || this.itemData[key] != 1) {
            this.itemData[key] = 1;
        } else {
            this.itemData[key] = 0;
        }
        this.saveItemList();
    }

    //
    // other utils
    //

    world_to_screen(pos, stack_count) {
        var p = pos;
        var screenPos = p.project(GRAPHICS.threeCamera());
        screenPos.x = (screenPos.x + 1) / 2 * window.innerWidth;
        screenPos.y = -(screenPos.y - 1) / 2 * window.innerHeight - (stack_count * 15);
        return screenPos;
    }

    ItemStack_intersects(ray, list) {
        const self = (this as any);
        let i = ray.intersectObject(self.mesh);
        if (!i || i.length == 0) return;

        let all_items = [];
        for (let i in self.item_info) {
            all_items.push({
                item: self.item_info[i],
                id: i
            });
        }
        all_items.sort((a, b) => b.item.value - a.item.value);

        let show_examine_options = true;
        if (all_items.length > ITEM_RIGHTCLICK_LIMIT / 2) show_examine_options = false;

        let options = 0;
        for (let entry of all_items) {
            let itemId = entry.id;
            let item = entry.item;
            if (options > ITEM_RIGHTCLICK_LIMIT) break;
            options++;
            if (show_examine_options) {
                list.push({
                    color: 'green',
                    distance: i.distance,
                    priority: - 1,
                    object: item,
                    text: 'Examine',
                    action: () =>CHAT.addGameMessage(item.examine)
                });
            }
            let all_keys = Object.keys(item.ids);
            list.push({
                color: 'red',
                distance: i.distance,
                priority: 1 + window[GenLiteItemHighlightPlugin.pluginName].getItemData(itemId) * 50,
                object: item,
                text: all_keys.length > 1 ? 'Take one' : 'Take',
                action: () =>{
                    let take_id = all_keys[Math.floor(Math.random() * all_keys.length)];
                    NETWORK.action('take', {
                        item: take_id
                    })
                }
            });
        }
    }

    //
    // update loop
    //

    update() {
        if (this.isPluginEnabled && this.render) {
            this.updateTrackedStacks();
            this.updateElements();
        }
    }

    updateTrackedStacks() {
        let itemStacks = GAME.items;
        let itemKeys = Object.keys(itemStacks);
        let keysToAdd = itemKeys.filter(k => !this.trackedStacks.includes(k));
        let keysToRemove = this.trackedStacks.filter(k => !itemKeys.includes(k));

        for (let key of keysToAdd) {
            // this.trackItem(key);
            let stack = itemStacks[key];
            this.createOrUpdateElement(key);
            this.trackedStacks.push(key);
        }

        for (let key of keysToRemove) {
            this.trackedStacks.splice(this.trackedStacks.indexOf(key), 1);
            this.removeElement(key);
        }
    }

    updateElements() {
        let stack_counter = {};
        let duplicates = {};

        for (let instanceId in this.itemElements) {
            let element = this.itemElements[instanceId];
            let stack = GAME.items[element.instanceId];
            let itemId = element.itemId;
            if (stack !== undefined) {
                if ((this.getItemData(itemId) == -1 || this.hideLables) && !this.isAltDown) {
                    element.element.style.visibility = 'hidden';
                    continue;
                }

                let pos = stack.location.position;
                let posKey = pos.x + ',' + pos.y;

                let dupeKey = posKey + '-' + itemId;
                if (duplicates[dupeKey]) {
                    element.element.style.visibility = 'hidden';
                    duplicates[dupeKey].count++;
                    continue;
                }
                duplicates[dupeKey] = {
                    count: 1,
                    element: element,
                };

                if (stack_counter[posKey] === undefined) {
                    stack_counter[posKey] = 0;
                }

                let worldPos = new THREE.Vector3().copy(stack.position());
                worldPos.y += 0.5;
                let screenPos = this.world_to_screen(worldPos, stack_counter[posKey]);
                if (screenPos.z > 1.0) {
                    element.element.style.visibility = 'hidden'; // Behind camera, hide
                } else {
                    element.element.style.visibility = 'visible'; // In front of camera, show
                }
                element.element.style.left = screenPos.x + "px";
                element.element.style.top = screenPos.y + "px";
                stack_counter[posKey]++;
            }
        }

        for (const i in duplicates) {
            let entry = duplicates[i];
            let e = entry.element;
            if (entry.count > 1) {
                e.element.children[0].innerText = `${e.itemName} x${entry.count}`
            } else {
                e.element.children[0].innerText = e.itemName;
            }
        }
    }
}
