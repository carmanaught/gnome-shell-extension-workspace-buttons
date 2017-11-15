// Credit: gcampax for some code from Workspace Indicator and Auto Move Windows,
// null4bl3 for some empty workspace detection ideas and lyonell for some code
// from All Windows for filtering lists of windows in workspaces.

const Clutter    = imports.gi.Clutter;
const Gio        = imports.gi.Gio;
const GObject    = imports.gi.GObject;
const Meta       = imports.gi.Meta;
const Shell      = imports.gi.Shell;
const St         = imports.gi.St;

const Lang       = imports.lang;
const Mainloop   = imports.mainloop;
const Util       = imports.misc.util;

const Main       = imports.ui.main;
const PanelMenu  = imports.ui.panelMenu;
const PopupMenu  = imports.ui.popupMenu;

const Gettext    = imports.gettext;
const _ = Gettext.domain("workspace-buttons").gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const Prefs = Me.imports.prefs;
const PrefsDialog = "gnome-shell-extension-prefs workspace-buttons@carmanaught.github.com";

const KEYS = {
    buttonsPos:         "buttons-position",
    buttonsPosChange:   "buttons-position-change",
    buttonsPosIndex:    "buttons-position-index",
    wrapAroundMode:     "wrap-around-mode",
    clickToActivate:    "click-to-activate",
    buttonToActivate:   "button-to-activate",
    emptyWorkStyle:     "empty-workspace-style",
    urgentWorkStyle:    "urgent-workspace-style",
    numLabel:           "workspace-label-number",
    nameLabel:          "workspace-label-name",
    labelSeparator:     "workspace-label-separator",
    indLabel:           "workspace-label-indicator",
    labelIndicators:    "workspace-label-indicators",
    urgentColor:        "urgent-color",
    hoverColor:         "hover-color",
    activeColor:        "active-color",
    inactiveColor:      "inactive-color",
    emptyColor:         "empty-color"
};

const WORKSPACE_SCHEMA = "org.gnome.desktop.wm.preferences";
const WORKSPACE_KEY = "workspace-names";

function debug(val) {
    val = `"[ Workspace Buttons ]--------> ${val}`;
    global.log(val);
}

const WorkspaceButton = Lang.Class({
    Name: "WorkspaceButton",
    Extends: PanelMenu.Button,
    
    _screenSignals: null,
    _displaySignals: null,
    _settingsSignals: null,
    
    destroy() {
        // Disconnect from signals we've connected to
        this._disconnectSignals();

        // Call parent
        this.parent();
    },
    
    _init(params) {
        this.parent(0.0, "WorkspaceButton");
        
        // Check for and get the index property
        if (params && params.hasOwnProperty("index")) {
            this._wsIndex = params.index;
            delete params.index;
        } else {
            this._wsIndex = -1;
        }
        this.metaWorkspace = global.screen.get_workspace_by_index(this._wsIndex);                
        // Change the button styling to reduce padding (normally "panel-button" style)
        this.actor.add_style_class_name("reduced-padding");
        
        // Initialize settings before anything else
        this._initSettings();
        
        // Create box layout
        this.workspaceButtonBox = new St.BoxLayout();
        
        // Create workspace label
        this.workspaceLabel = new St.Label({
            text: "",
            style: styleEmpty,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        
        // Add the label to the button box and add the button box to this PanelMenu.Button
        this.workspaceButtonBox.add_child(this.workspaceLabel);
        this.actor.add_child(this.workspaceButtonBox);

        // Now that we've created the label, update the label text and style the label
        this._updateLabel();
        this._updateStyle();
        
        // Connect to various signals
        this._connectSignals();
        // Add a delay so that the this.metaWorkspace.list_windows() of the _updateMenu function
        // will work properly, otherwise we'll have an empty window list.
        this._updateMenu();
        
        //this._mouseOver = false;
    },
    
    // I'm not sure about touch handling here. Ideally a regular touch should toggle the
    // menu, and a hold touch should bring the menu up after a short period, but I have
    // no touch device to test, so I'll leave the TOUCH_END to trigger the toggle.
    _onEvent(actor, event) {
        let doToggle = true;
        if (this.menu && (event.type() === Clutter.EventType.TOUCH_END ||  event.type() === Clutter.EventType.BUTTON_RELEASE || event.type() === Clutter.EventType.SCROLL)) {
            if (event.type() === Clutter.EventType.BUTTON_RELEASE) {
                if (this.clickActivate === true) {
                    let buttonCheck = (this.buttonActivate === "Primary") ? 1 : (this.buttonActivate === "Secondary") ? 3 : 1;
                    if (event.get_button() === buttonCheck && !this.menu.isOpen) {
                        this._setWorkspace(this._wsIndex);
                        doToggle = false;
                    }
                }
            }
            
            if (event.type() === Clutter.EventType.SCROLL) {
                this._scrollWorkspace(actor, event);
                doToggle = false;
            }
                    
            if (doToggle === true) {
                this._updateMenu();
                this.menu.toggle();
            }
        }
        
        //this.clickActivate
        //this.buttonActivate
        
        return Clutter.EVENT_PROPAGATE;
    },
    
    _initSettings() {
        // Event/action (wraparound)
        this.wraparoundMode = _settings.get_boolean(KEYS.wrapAroundMode);
        this.clickActivate = _settings.get_boolean(KEYS.clickToActivate);
        this.buttonActivate = _settings.get_string(KEYS.buttonToActivate);
        // Workspace style
        this.emptyWorkspaceStyle = _settings.get_boolean(KEYS.emptyWorkStyle);
        this.urgentWorkspaceStyle = _settings.get_boolean(KEYS.urgentWorkStyle);
        // Workspace label
        this.wkspNumber = _settings.get_boolean(KEYS.numLabel);
        this.wkspName = _settings.get_boolean(KEYS.nameLabel);
        this.wkspLabelSeparator = _settings.get_string(KEYS.labelSeparator);
        this.indStyle = _settings.get_boolean(KEYS.indLabel);
        this.activityIndicators = [];
        this.activityIndicators = _settings.get_strv(KEYS.labelIndicators);
    },
    
    _connectSignals() {
        // Seperate the signals into arrays to make it easier to disconnect them
        // by looping through signals with identical disconnect methods
        this._screenSignals = [];
        this._displaySignals = [];
        this._settingsSignals = [];
        this._workspaceSignals = [];
        
        this._windowTracker = Shell.WindowTracker.get_default();
        let display = global.screen.get_display();
        
        // These are purely settings updates
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.wrapAroundMode, () => {
            this.wraparoundMode = _settings.get_boolean(KEYS.wrapAroundMode);
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.clickToActivate, () => {
            this.clickActivate = _settings.get_boolean(KEYS.clickToActivate);
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.buttonToActivate, () => {
            this.buttonActivate = _settings.get_string(KEYS.buttonToActivate);
        }));
        
        // Change the buttons style (applied to the label)
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.emptyWorkStyle, () => {
            this.emptyWorkspaceStyle = _settings.get_boolean(KEYS.emptyWorkStyle);
            this._updateStyle();
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.urgentWorkStyle, () => {
            this.urgentWorkspaceStyle = _settings.get_boolean(KEYS.urgentWorkStyle);
            this._updateStyle();
        }));
        
        // Change the text of the labels as needed
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.numLabel, () => {
            this.wkspNumber = _settings.get_boolean(KEYS.numLabel);
            this._updateLabel();
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.nameLabel, () => {
            this.wkspName = _settings.get_boolean(KEYS.nameLabel);
            this._updateLabel();
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.labelSeparator, () => {
            this.wkspLabelSeparator = _settings.get_string(KEYS.labelSeparator);
            this._updateLabel();
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.indLabel, () => {
            this.indStyle = _settings.get_boolean(KEYS.indLabel);
            this._updateLabel();
            this._updateStyle();
        }));
        this._settingsSignals.push(_settings.connect("changed::" + KEYS.labelIndicators, () => {
            this.activityIndicators = _settings.get_strv(KEYS.labelIndicators);
            this._updateLabel();
        }));
        
        // Detect workspace name changes and update the button labels accordingly
        this._wkspNameSettings = new Gio.Settings({ schema_id: WORKSPACE_SCHEMA });
        this._wkspNameSignal = this._wkspNameSettings.connect("changed::" + WORKSPACE_KEY, () => {
            this._updateLabel();
        });
        
        // We'll need to update the workspace style when the workspace is changed and
        // also update the label to switch to/from the active workspace indicator
        this._screenSignals.push(global.screen.connect_after("workspace-switched", (screenObj, wsFrom, wsTo, wsDirection, wsPointer) => {
            if (this._wsIndex === wsFrom || this._wsIndex === wsTo) {
                this._updateMenu();
                this._updateStyle();
                this._updateLabel();
            }
        }));
        
        // This signal handler essentially replaces the "display" based 'window-created' signal
        // handler and helps trigger updates when windows are moved to workspaces without the
        // workspace itself being switched in the same action. This ignores windows considered
        // to be "on all workspaces".
        this._workspaceSignals.push(this.metaWorkspace.connect_after("window-added", (metaWorkspace, metaWindow) => {
            if (this._wsIndex === metaWorkspace.index() && metaWindow.is_on_all_workspaces() !== true) {
                this._updateMenu();
                this._updateStyle();
                this._updateLabel();
            }
        }));
        // This signal handler essentially replaces the "screen" based 'window-left-monitor'
        // signal and helps trigger updates when windows are removed from a workspace, ignoring
        // windows that are considered "on all workspaces".
        this._workspaceSignals.push(this.metaWorkspace.connect_after("window-removed", (metaWorkspace, metaWindow) => {
            if (this._wsIndex === metaWorkspace.index() && metaWindow.is_on_all_workspaces() !== true) {
                this._updateMenu();
                this._updateStyle();
                this._updateLabel();
            }
        }));
        
        // Connect AFTER we've got display (let display above) to ensure we can get the signal
        // on "MetaScreen" and avoid errors and so the handler from ShellWindowTracker has
        // already run. We can then change the style of the workspaces that trigger these.
        this._displaySignals.push(display.connect_after("window-demands-attention", (metaDisplay, metaWindow) => {
            if (this._wsIndex === metaWindow.get_workspace().index()) {
                this._updateStyle();
            }
        }));
        this._displaySignals.push(display.connect_after("window-marked-urgent", (metaDisplay, metaWindow) => {
            if (this._wsIndex === metaWindow.get_workspace().index()) {
                this._updateStyle();
            }
        }));
        
        // Connect to the menu open-state-changed signal and update the menu
        this._menuStateSignal = this.menu.connect("open-state-changed", () => {
            this._updateMenu();
            this._updateStyle();
            this._updateLabel();
        });
        
        // Connect to the signals for enter-event/leave-event for this button and change the
        // style as needed.
        this._hoverOverSignal = this.actor.connect("enter-event", () => {
            // Change hover (except for urgent)
            if (!this.workspaceLabel._urgent) {
                this.workspaceLabel.set_style(styleHover);
            }
        })
        this._hoverOutSignal = this.actor.connect("leave-event", () => {
            // Change style back
            if (!this.workspaceLabel._urgent) {
                this._updateStyle();
            }
        })
    },
    
    _disconnectSignals() {
        let display = global.screen.get_display();
        
        // Disconnect settings signals
        for (let x = 0; x < this._settingsSignals.length; x++) {
            _settings.disconnect(this._settingsSignals[x]);
        }
        this._settingsSignals = [];
        this._settingsSignals = null;
        
        this._wkspNameSettings.disconnect(this._wkspNameSignal);
        
        // Disconnect screen signals
        for (let x = 0; x < this._screenSignals.length; x++) {
            global.screen.disconnect(this._screenSignals[x]);
        }
        this._screenSignals = [];
        this._screenSignals = null;
        
        for (let x = 0; x < this._workspaceSignals.length; x++) {
            this.metaWorkspace.disconnect(this._workspaceSignals[x]);
        }
        this._workspaceSignals = [];
        this._workspaceSignals = null;
        
        // Disconnect display signals
        for (let x = 0; x < this._displaySignals.length; x++) {
            display.disconnect(this._displaySignals[x]);
        }
        this._displaySignals = [];
        this._displaySignals = null;
        
        // Disconnect various other signals
        this.menu.disconnect(this._menuStateSignal);
        this.actor.disconnect(this._hoverOverSignal);
        this.actor.disconnect(this._hoverOutSignal);
    },
    
    _updateMenu() {
        // Add delay for this.metaWorkspace.list_windows();
        Mainloop.timeout_add(1, () => {
            this.menu.removeAll();
            let emptyMenu = true;
            
            let workspaceName = Meta.prefs_get_workspace_name(this._wsIndex);
            // Stop executing inside the timeout if the workspace is undefined since
            // it means the workspace is probably gone.
            if (this.metaWorkspace === null) { return false; }
            let windowList = this.metaWorkspace.list_windows();
            let stickyWindows = windowList.filter(function(w) {
                return !w.is_skip_taskbar() && w.is_on_all_workspaces();
            });
            let regularWindows = windowList.filter(function(w) {
                return !w.is_skip_taskbar() && !w.is_on_all_workspaces();
            });
            
            let workspaceActivate = new PopupMenu.PopupMenuItem(`${_("Activate Workspace")} ${(this._wsIndex + 1)}`);
            workspaceActivate.connect("activate", () => { this._setWorkspace(this._wsIndex); });
            this.menu.addMenuItem(workspaceActivate);
            let prefsActivate = new PopupMenu.PopupMenuItem(_("Settings"));
            prefsActivate.connect("activate", () => { Main.Util.trySpawnCommandLine(PrefsDialog); });
            this.menu.addMenuItem(prefsActivate);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            
            if (regularWindows.length > 0) {
                let workspaceLabel = new PopupMenu.PopupMenuItem(`${(this._wsIndex + 1)}: ${workspaceName}`);
                workspaceLabel.actor.reactive = false;
                workspaceLabel.actor.can_focus = false;
                if (this._wsIndex == global.screen.get_active_workspace().index()) {
                    workspaceLabel.setOrnament(PopupMenu.Ornament.DOT);
                }
                this.menu.addMenuItem(workspaceLabel);
                
                for ( let i = 0; i < regularWindows.length; ++i ) {
                    let metaWindow = regularWindows[i];
                    let windowItem = new PopupMenu.PopupBaseMenuItem();
                    windowItem.connect("activate", () => { this._activateWindow(this.metaWorkspace, metaWindow) });
                    windowItem._window = regularWindows[i];
                    
                    let windowApp = this._windowTracker.get_window_app(windowItem._window);
                    let windowBox = new St.BoxLayout( { x_expand: true  } );
                    windowItem._icon = windowApp.create_icon_texture(16);
                    if (metaWindow.urgent || metaWindow.demands_attention) {
                        windowBox.add(new St.Label({ text: this._ellipsizeWindowTitle(metaWindow),
                            x_expand: true, style: styleUrgent }));
                    } else {
                        windowBox.add(new St.Label({ text: this._ellipsizeWindowTitle(metaWindow),
                            x_expand: true }));
                    }
                    windowBox.add(new St.Label({ text: "   " }));
                    windowBox.add(windowItem._icon);
                    windowItem.actor.add_actor(windowBox);
                    this.menu.addMenuItem(windowItem);
                    emptyMenu = false;
                }
            }
            
            if (emptyMenu) {
                let emptyItem = new PopupMenu.PopupMenuItem(_("No open windows"))
                emptyItem.actor.reactive = false;
                emptyItem.actor.can_focus = false;
                this.menu.addMenuItem(emptyItem);
            }
            
            return false;
        });
    },
    
    _updateStyle() {
        this.currentWorkSpace = global.screen.get_active_workspace().index()
        
        // Add delay for this.metaWorkspace.list_windows();
        Mainloop.timeout_add(1, () => {
            let workspaceName = Meta.prefs_get_workspace_name(this._wsIndex);
            // Stop executing inside the timeout if the workspace is undefined since
            // it means the workspace is probably gone.
            if (this.metaWorkspace == undefined) { return false; }
            let windowList = this.metaWorkspace.list_windows();
            let stickyWindows = windowList.filter(function (w) {
                return !w.is_skip_taskbar() && w.is_on_all_workspaces();
            });
            let regularWindows = windowList.filter(function(w) {
                return !w.is_skip_taskbar() && !w.is_on_all_workspaces();
            });
            let urgentWindows = windowList.filter(function(w) {
                return w.urgent || w.demands_attention;
            });
            
            this.workspaceLabel._urgent = false;
            if (this._wsIndex !== this.currentWorkSpace && urgentWindows.length > 0 && this.urgentWorkspaceStyle === true) {
                this.workspaceLabel._urgent = true;
                this.workspaceLabel.style = styleUrgent;
            } else if (this._wsIndex === this.currentWorkSpace) {
                this.workspaceLabel.style = styleActive;
            } else if (regularWindows.length > 0) {
                this.workspaceLabel.style = styleInactive;
            } else {
                let emptyStyle = (this.emptyWorkspaceStyle === true) ? styleEmpty : styleInactive;
                this.workspaceLabel.style = emptyStyle;
            }
            
            return false;
        });
    },
    
    _updateLabel() {
        let workspaceName = Meta.prefs_get_workspace_name(this._wsIndex);
        this.currentWorkSpace = global.screen.get_active_workspace().index();
        
        let wsNum = "";
        let wsName = "";
        let str = "";
        let actIndicator = false;
        
        let emptyName = false;
        // Check that workspace has label (returns "Workspace <Num>" if not),
        // which also explicitly blocks use of the word "Workspace" in a label.
        if (workspaceName.indexOf("Workspace") !== -1) {
            emptyName = true;
        }
        
        wsNum = (this._wsIndex + 1).toString();
        wsName = workspaceName;
        
        // Change workspace label depending on the use of activity indicators
        if (this.wkspNumber === true && this.wkspName === false) {
            str = wsNum;
        }
        if (this.wkspNumber === false && this.wkspName === true) {
            if (this.indStyle === true) { actIndicator = true; }
            else {
                if (emptyName === true) { str = wsNum; }
                else { str = wsName; }
            }
        }
        if (this.wkspNumber === true && this.wkspName === true) {
            if (this.indStyle === true) {
                actIndicator = true;
                str = wsNum + this.wkspLabelSeparator;
            } else {
                if (emptyName === true) { str = wsNum; }
                else { str = wsNum + this.wkspLabelSeparator + wsName; }
            }
        }
        
        Mainloop.timeout_add(1, () => {
            let workspaceName = Meta.prefs_get_workspace_name(this._wsIndex);
            // Stop executing inside the timeout if the workspace is undefined since
            // it means the workspace is probably gone.
            if (this.metaWorkspace === null) { return false; }
            let windowList = this.metaWorkspace.list_windows();
            let stickyWindows = windowList.filter(function (w) {
                return !w.is_skip_taskbar() && w.is_on_all_workspaces();
            });
            let regularWindows = windowList.filter(function(w) {
                return !w.is_skip_taskbar() && !w.is_on_all_workspaces();
            });
            let urgentWindows = windowList.filter(function(w) {
                return w.urgent || w.demands_attention;
            });
            
            // Do checks to determine the format of the label
            if (this._wsIndex === this.currentWorkSpace) {
                str = (actIndicator === true) ? str + this.activityIndicators[2] : str;
            } else if (urgentWindows.length > 0 || regularWindows.length > 0) {
                str = (actIndicator === true) ? str + this.activityIndicators[1] : str;
            } else if (regularWindows.length === 0 && this.emptyWorkspaceStyle === true) {
                str = (actIndicator === true) ? str + this.activityIndicators[0] : str;
            } else if (regularWindows.length > 0 || this._wsIndex !== this.currentWorkSpace) {
                str = (actIndicator === true) ? str + this.activityIndicators[1] : str;
            }
            
            this.workspaceLabel.text = str;
            
            return false;
        });
        
        
    },
    
    _setWorkspace(index) {
        // Taken from workspace-indicator
        if (index >= 0 && index < global.screen.n_workspaces) {
	        let metaWorkspace = global.screen.get_workspace_by_index(index);
	        metaWorkspace.activate(global.get_current_time());
        }
    },
    
    _activateScroll(offSet) {
        this.currentWorkSpace = global.screen.get_active_workspace().index() + offSet;
        let workSpaces = global.screen.n_workspaces - 1;
        let scrollBack = 0;
        let scrollFwd = 0;
        
        if (this.wraparoundMode ===  true) {
            scrollBack = workSpaces;
            scrollFwd = 0;
        } else {
            scrollBack = 0;
            scrollFwd = workSpaces;
        }
        
        if (this.currentWorkSpace < 0) this.currentWorkSpace = scrollBack;
        if (this.currentWorkSpace > workSpaces) this.currentWorkSpace = scrollFwd;
        
        this._setWorkspace(this.currentWorkSpace);
    },
    
    _scrollWorkspace(actor, event) {
        let direction = event.get_scroll_direction();
        let offSet = 0;

        if (direction === Clutter.ScrollDirection.DOWN) {
            offSet = 1;
        } else if (direction === Clutter.ScrollDirection.UP) {
            offSet = -1;
        } else {
            return;
        }

        this._activateScroll(offSet);
    },
    
    _activateWindow(metaWorkspace, metaWindow) {
        if(!metaWindow.is_on_all_workspaces()) { metaWorkspace.activate(global.get_current_time()); }
        metaWindow.unminimize();
        metaWindow.unshade(global.get_current_time());
        metaWindow.activate(global.get_current_time());
    },
    
    _ellipsizeString(str, len) {
        if(str.length > len) { 
            return `${str.substr(0, len)}...`;
        }
        return str; 
    },
    
    _ellipsizeWindowTitle(window) {
        return this._ellipsizeString(window.get_title(), 45);
    },
});

let _settings;
let globalSettingsSignals = null;

let styleUrgent;
let styleHover;
let styleActive;
let styleInactive;
let styleEmpty;

let panelBox;
let workspaceButton;
let workspaceSignals;

function updateStyleList() {
    styleUrgent     = "color:" + _settings.get_string(KEYS.urgentColor);
    styleHover      = "color:" + _settings.get_string(KEYS.hoverColor);
    styleActive     = "color:" + _settings.get_string(KEYS.activeColor);
    styleInactive   = "color:" + _settings.get_string(KEYS.inactiveColor);
    styleEmpty      = "color:" + _settings.get_string(KEYS.emptyColor);
}

function updateButtonStyles() {
    for (let x = 0; x < workspaceButton.length; x++) {
        workspaceButton[x]._updateStyle();
    }
}

function buildWorkspaceButtons () {
    let buttonsIndexChange = _settings.get_boolean(KEYS.buttonsPosChange);
    let buttonsIndex = (buttonsIndexChange === true) ? _settings.get_int(KEYS.buttonsPosIndex) : 1
    panelBox = _settings.get_string(KEYS.buttonsPos)
    workspaceButton = [];
    
    if (panelBox !== "right") {
        Main.panel[`_${panelBox}Box`].add_style_class_name("panel-spacing");
    }
    
    var workSpaces = 0;
    workSpaces = global.screen.n_workspaces;
    for (let x = 0; x < workSpaces; x++) {
        workspaceButton[x] = new WorkspaceButton({index: x});
        if (Main.panel.statusArea[`workspaceButton${(x + 1)}`] !== undefined) {
            Main.panel.statusArea[`workspaceButton${(x + 1)}`].destroy();
        }
        Main.panel.addToStatusArea(`workspaceButton${(x + 1)}`, workspaceButton[x], (x + buttonsIndex), panelBox)
    }
}

function destroyWorkspaceButtons () {
    if (panelBox !== "right") {
        Main.panel[`_${panelBox}Box`].remove_style_class_name("panel-spacing");
    }
    
    var workSpaces = 0;
    workSpaces = global.screen.n_workspaces;
    while (workspaceButton.length > 0) {
        let thisButton = workspaceButton.pop()
        if (thisButton !== undefined) {
            thisButton.destroy();
        }
    }
}

function setPosition() {
    destroyWorkspaceButtons();
    Mainloop.timeout_add(100, () => {
        buildWorkspaceButtons();
        return false;
    });
}

function init () {
    _settings = Convenience.getSettings();
    updateStyleList();
    // Get this to define which panel box to work with (_leftBox/_centerBox/_rightBox)
    panelBox = _settings.get_string(KEYS.buttonsPos);
}

function enable() {
    let workspacesChanged = false;
    workspaceSignals = [];
    // It's easiest if we rebuild the buttons when workspaces are removed or added
    workspaceSignals.push(global.screen.connect_after("notify::n-workspaces", (metaScreen, paramSpec) => {
        // Only change the workspaces once, after a delay to allow for workspaces to be removed and
        // to prevent errors with sudden repeated workspace count changes.
        if (workspacesChanged === false) {
            Mainloop.timeout_add(100, () => {
                destroyWorkspaceButtons();
                buildWorkspaceButtons();
                // Reset this in the timeout so that future workspace changes will work.
                workspacesChanged = false;
                return false;
            });
            // Use this to avoid adding new timeouts to the Mainloop.
            workspacesChanged = true;
        }
    }));
    
    // Set signals to get changes when made to preferences
    globalSettingsSignals = [];
    
    // Changes to these settings require a rebuild of the buttons
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.buttonsPos, () => {
        setPosition();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.buttonsPosChange, () => {
        setPosition();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.buttonsPosIndex, () => {
        setPosition();
    }));
    
    // We need to trigger button color updates when any one of these is changed
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.urgentColor, () => {
        updateStyleList();
        updateButtonStyles();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.hoverColor, () => {
        updateStyleList();
        updateButtonStyles();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.activeColor, () => {
        updateStyleList();
        updateButtonStyles();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.inactiveColor, () => {
        updateStyleList();
        updateButtonStyles();
    }));
    globalSettingsSignals.push(_settings.connect_after("changed::" + KEYS.emptyColor, () => {
        updateStyleList();
        updateButtonStyles();
    }));
    
    Mainloop.timeout_add(500, () => {
        buildWorkspaceButtons();
        return false;
    });
}

function disable() {
    for (let x = 0; x < workspaceSignals.length; x++) {
        global.screen.disconnect(workspaceSignals[x]);
    }
    workspaceSignals = [];
    workspaceSignals = null;
    
    for (let x = 0; x < globalSettingsSignals.length; x++) {
        _settings.disconnect(globalSettingsSignals[x]);
    }
    globalSettingsSignals = [];
    globalSettingsSignals = null;
    
    destroyWorkspaceButtons();
}
