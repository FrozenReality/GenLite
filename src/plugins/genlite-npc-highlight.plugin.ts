import { GenLiteWikiDataCollectionPlugin } from "./genlite-wiki-data-collection.plugin";

import {GenLitePlugin} from '../core/interfaces/plugin.interface';

export class GenLiteNPCHighlightPlugin implements GenLitePlugin {
    static pluginName = 'GenLiteNPCHighlightPlugin';
    static healthListVersion = "2"

    trackedNpcs = {};
    npcData = {};
    npc_highlight_div = null;
    render = false;
    npcHealthList: {
        [key: string]: any
        version: string
    };
    curCombat: string = "";
    curEnemy: string = ""

    combatX = 0;
    combatY = 0;

    isPluginEnabled: boolean = false;
    hideInvert: boolean = true;
    isAltDown: boolean = false;

    packList;
    async init() {
        window.genlite.registerPlugin(this);

        this.npc_highlight_div = document.createElement('div');
        this.npc_highlight_div.className = 'npc-indicators-list';
        document.body.appendChild(this.npc_highlight_div);
        this.npcHealthList = JSON.parse(localStorage.getItem("GenliteNPCHealthList"));
        if (this.npcHealthList == null || GenLiteNPCHighlightPlugin.healthListVersion != this.npcHealthList.version)
            this.npcHealthList = { version: GenLiteNPCHighlightPlugin.healthListVersion };
        this.npcData = JSON.parse(localStorage.getItem("GenliteNpcHideData"));
        if (this.npcData == null || GenLiteNPCHighlightPlugin.healthListVersion != this.npcHealthList.version)
            this.npcData = {};

        window.addEventListener('keydown', this.keyDownHandler.bind(this));
        window.addEventListener('keyup', this.keyUpHandler.bind(this));
        window.addEventListener("blur", this.blurHandler.bind(this))

        this.isPluginEnabled = window.genlite.settings.add("NpcHighlight.Enable", true, "Highlight NPCs", "checkbox", this.handlePluginEnableDisable, this);
        this.hideInvert = window.genlite.settings.add("NpcHideInvert.Enable", true, "Invert NPC Hiding", "checkbox", this.handleHideInvertEnableDisable, this, undefined, undefined, "NpcHighlight.Enable");

    }

    async postInit() {
        this.packList = window.GenLiteWikiDataCollectionPlugin.packList;
    }

    handlePluginEnableDisable(state: boolean) {
        // when disabling the plugin clear the current list of npcs
        if (state === false) {
            this.npc_highlight_div.innerHTML = '';
            this.trackedNpcs = {};
        }

        this.isPluginEnabled = state;
    }

    handleHideInvertEnableDisable(state: boolean) {
        // always clear the current list of npcs
        this.npc_highlight_div.innerHTML = '';
        this.trackedNpcs = {};

        this.hideInvert = state;
    }

    update(dt) {
        if (this.isPluginEnabled === false || this.render === false) {
            return;
        }

        let npcsToAdd = Object.keys(GAME.npcs).filter(x => !Object.keys(this.trackedNpcs).includes(x));
        let npcsToRemove = Object.keys(this.trackedNpcs).filter(x => !Object.keys(GAME.npcs).includes(x));

        for (let key in npcsToAdd) {
            let npc = GAME.npcs[npcsToAdd[key]]
            let hpKey = this.packList[npc.id.split('-')[0]]
            let text = npc.htmlName;
            if (this.npcHealthList[hpKey] !== undefined)
                text += ` HP: ${this.npcHealthList[hpKey]}`
            text += `
            <div class="genlite-npc-setting" style="display: ${this.isAltDown ? "inline-block" : "none"}; pointer-events: auto;" onclick="window.${GenLiteNPCHighlightPlugin.pluginName}.hide_item('${hpKey}');void(0);"> &#8863;</div>`;
            this.trackedNpcs[npcsToAdd[key]] = this.create_text_element(hpKey, text);
        }

        for (let key in npcsToRemove) {
            this.trackedNpcs[npcsToRemove[key]].remove();
            delete this.trackedNpcs[npcsToRemove[key]];
        }

        for (let key in this.trackedNpcs) {
            let worldPos;
            if (GAME.npcs[key] !== undefined) {
                /* if in combat grab the threeObject position (the actual current position of the sprite not the world pos)
                    mult by 0.8 which is the height of the health bar
                */
                if (key == this.curEnemy) {
                    worldPos = new THREE.Vector3().copy(GAME.npcs[key].object.position());
                    worldPos.y += 0.8;
                } else {
                    worldPos = new THREE.Vector3().copy(GAME.npcs[key].position());
                    worldPos.y += GAME.npcs[key].height
                }
                let screenPos = this.world_to_screen(worldPos);
                if (key == this.curEnemy)
                    screenPos.y *= 0.9; // move the name tag a fixed position above the name tag
                let zHide = screenPos.z > 1.0; //if behind camera
                let npcHide = this.hideInvert ? this.npcData[this.packList[key.split('-')[0]]] == 1 : !(this.npcData[this.packList[key.split('-')[0]]] == 1);
                if (zHide || (npcHide && !this.isAltDown)) {
                    this.trackedNpcs[key].style.visibility = 'hidden';
                } else {
                    this.trackedNpcs[key].style.visibility = 'visible';
                }
                this.trackedNpcs[key].style.top = screenPos.y + "px";
                this.trackedNpcs[key].style.left = screenPos.x + "px";

            }
        }
    }

    loginOK() {
        this.render = true;
    }

    logoutOK() {
        this.npc_highlight_div.innerHTML = '';
        this.trackedNpcs = {};
        this.render = false;
    }

    /* figure out which npc we are fighting and when that combat ends */
    handle(verb, payload) {
        if (this.isPluginEnabled === false || NETWORK.loggedIn === false) {
            return;
        }

        /* look for start of combat set the curEnemy and record data */
        if (verb == "spawnObject" && payload.type == "combat" &&
            (payload.participant1 == PLAYER.id || payload.participant2 == PLAYER.id)) {
            this.curCombat = payload.id;
            let curCombat = GAME.combats[payload.id];
            this.curEnemy = curCombat.left.id == PLAYER.id ? curCombat.right.id : curCombat.left.id;
            return;
        }
        if (verb == "removeObject" && payload.type == "combat" && payload.id == this.curCombat) {
            this.curCombat = "";
            this.curEnemy = "";
            return;
        }
    }

    combatUpdate(update) {
        if (this.isPluginEnabled === false) {
            return;
        }
        let object = GAME.objectById(update.id);
        if (update.id == PLAYER.id || GAME.players[update.id] !== undefined || object === undefined)
            return;

        let hpKey = this.packList[object.id.split('-')[0]];
        if (hpKey === undefined)
            return;

        let npcsToMod;
        if (this.npcHealthList[hpKey] === undefined) {
            this.npcHealthList[hpKey] = update.maxhp;
            localStorage.setItem("GenliteNPCHealthList", JSON.stringify(this.npcHealthList));
            npcsToMod = Object.keys(GAME.npcs).filter(x => GAME.npcs[x].id.split('-')[0] == object.id.split('-')[0]);
        }
        for (let key in npcsToMod) {
            let npcid = npcsToMod[key];
            this.trackedNpcs[npcid].innerHTML += ` HP: ${this.npcHealthList[hpKey]}`;
        }
        if (this.trackedNpcs.hasOwnProperty(object.id))
            this.trackedNpcs[object.id].innerHTML = `<div>${object.htmlName}</div><div>HP: ${update.hp}/${update.maxhp}</div>`;
    }


    world_to_screen(pos) {
        var p = pos;
        var screenPos = p.project(GRAPHICS.threeCamera());

        screenPos.x = (screenPos.x + 1) / 2 * window.innerWidth;
        screenPos.y = -(screenPos.y - 1) / 2 * window.innerHeight;

        return screenPos;
    }

    create_text_element(key, text) {
        let element = document.createElement('div');
        if (this.hideInvert) {
            element.className = this.npcData[key] == 1 ? 'spell-locked' : 'text-yellow';
        } else {
            element.className = this.npcData[key] == 1 ? 'text-yellow' : 'spell-locked';
        }
        element.style.position = 'absolute';
        //element.style.zIndex = '99999';
        element.innerHTML = text;
        element.style.transform = 'translateX(-50%)';
        element.style.textShadow = '-1px -1px 0 #000,0   -1px 0 #000, 1px -1px 0 #000, 1px  0   0 #000, 1px  1px 0 #000, 0    1px 0 #000, -1px  1px 0 #000, -1px  0   0 #000';
        element.style.pointerEvents = 'none';

        this.npc_highlight_div.appendChild(element);

        return element;
    }

    hide_item(packId) {
        if (!this.npcData.hasOwnProperty(packId))
            this.npcData[packId] = 0;

        if (this.npcData[packId] != 1)
            this.npcData[packId] = 1;
        else
            this.npcData[packId] = 0;

        this.save_item_list();
    }

    save_item_list() {
        this.npc_highlight_div.innerHTML = '';
        this.trackedNpcs = {};
        localStorage.setItem("GenliteNpcHideData", JSON.stringify(this.npcData));
    }


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

    setDisplayState(state) {
        const hiddenElements = document.querySelectorAll('.genlite-npc-setting') as NodeListOf<HTMLElement>;

        hiddenElements.forEach((element) => {
            element.style.display = state;
        });
    }
}
