/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LayoutPriority, Orientation, Sizing, SplitView } from 'vs/base/browser/ui/splitview/splitview';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITerminalService, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalFindWidget } from 'vs/workbench/contrib/terminal/browser/terminalFindWidget';
import { DEFAULT_TABS_WIDGET_WIDTH, MIDPOINT_WIDGET_WIDTH, MIN_TABS_WIDGET_WIDTH, TerminalTabsWidget } from 'vs/workbench/contrib/terminal/browser/terminalTabsWidget';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import * as dom from 'vs/base/browser/dom';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { DataTransfers } from 'vs/base/browser/dnd';
import { URI } from 'vs/base/common/uri';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { IMenu, IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE } from 'vs/workbench/contrib/terminal/common/terminal';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ILogService } from 'vs/platform/log/common/log';

const $ = dom.$;

const FIND_FOCUS_CLASS = 'find-focused';
const TABS_WIDGET_WIDTH_KEY = 'tabs-widget-width';
const MAX_TABS_WIDGET_WIDTH = 500;
const STATUS_ICON_WIDTH = 30;
const SPLIT_ANNOTATION_WIDTH = 30;

export class TerminalTabbedView extends Disposable {

	private _splitView: SplitView;

	private _terminalContainer: HTMLElement;
	private _terminalTabTree: HTMLElement;
	private _parentElement: HTMLElement;
	private _tabTreeContainer: HTMLElement;

	private _tabsWidget: TerminalTabsWidget;
	private _findWidget: TerminalFindWidget;
	private _sashDisposables: IDisposable[] | undefined;

	private _plusButton: HTMLElement | undefined;

	private _tabTreeIndex: number;
	private _terminalContainerIndex: number;

	private _showTabs: boolean;
	private _findWidgetVisible: IContextKey<boolean>;

	private _height: number | undefined;
	private _width: number | undefined;

	private _cancelContextMenu: boolean = false;
	private _instanceMenu: IMenu;
	private _tabsWidgetMenu: IMenu;
	private _tabsWidgetEmptyMenu: IMenu;

	constructor(
		parentElement: HTMLElement,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IThemeService private readonly _themeService: IThemeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IMenuService menuService: IMenuService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._parentElement = parentElement;

		this._tabTreeContainer = $('.tabs-container');
		const tabWidgetContainer = $('.tabs-widget-container');
		this._terminalTabTree = $('.tabs-widget');
		tabWidgetContainer.appendChild(this._terminalTabTree);
		this._tabTreeContainer.appendChild(tabWidgetContainer);

		this._instanceMenu = this._register(menuService.createMenu(MenuId.TerminalContainerContext, contextKeyService));
		this._tabsWidgetMenu = this._register(menuService.createMenu(MenuId.TerminalTabsWidgetContext, contextKeyService));
		this._tabsWidgetEmptyMenu = this._register(menuService.createMenu(MenuId.TerminalTabsWidgetEmptyContext, contextKeyService));

		this._register(this._tabsWidget = this._instantiationService.createInstance(TerminalTabsWidget, this._terminalTabTree));
		this._register(this._findWidget = this._instantiationService.createInstance(TerminalFindWidget, this._terminalService.getFindState()));
		parentElement.appendChild(this._findWidget.getDomNode());

		this._terminalContainer = document.createElement('div');
		this._terminalContainer.classList.add('terminal-outer-container');
		this._terminalContainer.style.display = 'block';

		this._showTabs = this._terminalService.configHelper.config.showTabs;

		this._tabTreeIndex = this._terminalService.configHelper.config.tabsLocation === 'left' ? 0 : 1;
		this._terminalContainerIndex = this._terminalService.configHelper.config.tabsLocation === 'left' ? 1 : 0;

		this._findWidgetVisible = KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE.bindTo(contextKeyService);

		this._terminalService.setContainers(parentElement, this._terminalContainer);

		_configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('terminal.integrated.showTabs')) {
				this._showTabs = this._terminalService.configHelper.config.showTabs;
				if (this._showTabs) {
					this._addTabTree();
					this._addSashListener();
					this._splitView.resizeView(this._tabTreeIndex, DEFAULT_TABS_WIDGET_WIDTH);
				} else {
					this._splitView.removeView(this._tabTreeIndex);
					if (this._plusButton) {
						this._tabTreeContainer.removeChild(this._plusButton);
					}
					this._removeSashListener();
				}
			} else if (e.affectsConfiguration('terminal.integrated.tabsLocation')) {
				this._tabTreeIndex = this._terminalService.configHelper.config.tabsLocation === 'left' ? 0 : 1;
				this._terminalContainerIndex = this._terminalService.configHelper.config.tabsLocation === 'left' ? 1 : 0;
				if (this._showTabs) {
					this._splitView.swapViews(0, 1);
					this._splitView.resizeView(this._tabTreeIndex, this._getLastWidgetWidth());
				}
			}
		});

		this._register(this._themeService.onDidColorThemeChange(theme => this._updateTheme(theme)));
		this._updateTheme();

		this._findWidget.focusTracker.onDidFocus(() => this._terminalContainer!.classList.add(FIND_FOCUS_CLASS));

		this._attachEventListeners(parentElement, this._terminalContainer);

		this._splitView = new SplitView(parentElement, { orientation: Orientation.HORIZONTAL, proportionalLayout: false });

		this._setupSplitView();

		this._terminalService.onPanelMovedToSide(() => {
			try {
				this._updateWidgetWidth(MIN_TABS_WIDGET_WIDTH);
			} catch (e) {
			}
		});
	}

	private _getLastWidgetWidth(): number {
		const storedValue = this._storageService.get(TABS_WIDGET_WIDTH_KEY, StorageScope.WORKSPACE);
		if (!storedValue || !parseInt(storedValue)) {
			return DEFAULT_TABS_WIDGET_WIDTH;
		}
		return parseInt(storedValue);
	}

	private _handleOnDidSashReset(): void {
		// Calculate ideal size of widget to display all text based on its contents
		let idealWidth = DEFAULT_TABS_WIDGET_WIDTH;
		const offscreenCanvas = new OffscreenCanvas(1, 1);
		const ctx = offscreenCanvas.getContext('2d');
		if (ctx) {
			const style = window.getComputedStyle(this._terminalTabTree);
			ctx.font = `${style.fontStyle} ${style.fontSize} ${style.fontFamily}`;
			const maxTextSize = this._terminalService.terminalInstances.reduce((p, c) => {
				return Math.max(p, ctx.measureText(c.title).width);
			}, 0);
			idealWidth = Math.ceil(Math.max(maxTextSize + this._getAdditionalWidth(), DEFAULT_TABS_WIDGET_WIDTH));
		}
		// If the size is already ideal, toggle to collapsed
		const currentWidth = Math.ceil(this._splitView.getViewSize(this._tabTreeIndex));
		if (currentWidth === idealWidth) {
			idealWidth = MIN_TABS_WIDGET_WIDTH;
		}
		this._splitView.resizeView(this._tabTreeIndex, idealWidth);
		this._updateWidgetWidth(idealWidth);
	}

	private _getAdditionalWidth(): number {
		// Size to include padding, icon, status icon (if any), split annotation (if any), + a little more
		const additionalWidth = 30;
		const statusIconWidth = this._terminalService.terminalInstances.find(i => i.statusList.statuses.length > 0) ? STATUS_ICON_WIDTH : 0;
		const splitAnnotationWidth = this._terminalService.terminalTabs.find(t => t.terminalInstances.length > 1) ? SPLIT_ANNOTATION_WIDTH : 0;
		if (statusIconWidth === 0 && splitAnnotationWidth === 0) {
			return additionalWidth;
		} else if (splitAnnotationWidth === 0 || statusIconWidth === 0) {
			// splits or status
			return additionalWidth + splitAnnotationWidth + statusIconWidth;
		} else {
			// check if a split terminal has a status icon
			for (const tab of this._terminalService.terminalTabs.filter(t => t.terminalInstances.length > 1)) {
				for (const instance of tab.terminalInstances) {
					if (instance.statusList.statuses.length > 0) {
						return additionalWidth + statusIconWidth + splitAnnotationWidth - 10;
					}
				}
			}
			return additionalWidth + statusIconWidth;
		}
	}

	private _handleOnDidSashChange(): void {
		let widgetWidth = this._splitView.getViewSize(this._tabTreeIndex);
		if (!this._width || widgetWidth <= 0) {
			return;
		}
		this._updateWidgetWidth(widgetWidth);
	}

	private _updateWidgetWidth(width: number): void {
		if (width < MIDPOINT_WIDGET_WIDTH && width >= MIN_TABS_WIDGET_WIDTH) {
			width = MIN_TABS_WIDGET_WIDTH;
			this._splitView.resizeView(this._tabTreeIndex, width);
		} else if (width >= MIDPOINT_WIDGET_WIDTH && width < DEFAULT_TABS_WIDGET_WIDTH) {
			width = DEFAULT_TABS_WIDGET_WIDTH;
			this._splitView.resizeView(this._tabTreeIndex, width);
		}
		this._refreshHasTextClass();
		this._rerenderTabs();
		this._storageService.store(TABS_WIDGET_WIDTH_KEY, width, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private _setupSplitView(): void {
		this._register(this._splitView.onDidSashReset(() => this._handleOnDidSashReset()));
		this._register(this._splitView.onDidSashChange(() => this._handleOnDidSashChange()));

		if (this._showTabs) {
			this._addTabTree();
		}
		this._splitView.addView({
			element: this._terminalContainer,
			layout: width => this._terminalService.terminalTabs.forEach(tab => tab.layout(width, this._height || 0)),
			minimumSize: 120,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: () => Disposable.None,
			priority: LayoutPriority.High
		}, Sizing.Distribute, this._terminalContainerIndex);

		if (this._showTabs) {
			this._addSashListener();
		}
	}

	private _addTabTree() {
		this._splitView.addView({
			element: this._tabTreeContainer,
			layout: width => this._tabsWidget.layout(this._height || 0, width),
			minimumSize: MIN_TABS_WIDGET_WIDTH,
			maximumSize: MAX_TABS_WIDGET_WIDTH,
			onDidChange: () => Disposable.None,
			priority: LayoutPriority.Low
		}, Sizing.Distribute, this._tabTreeIndex);
		this._refreshHasTextClass();
		this._rerenderTabs();
	}

	private _rerenderTabs() {
		for (const instance of this._terminalService.terminalInstances) {
			try {
				this._tabsWidget.rerender(instance);
			} catch (e) {
				this._logService.warn('Exception when rerendering new tab widget', e);
			}
		}
	}

	private _addSashListener() {
		let interval: number;
		this._sashDisposables = [
			this._splitView.sashes[0].onDidStart(e => {
				interval = window.setInterval(() => {
					this._refreshHasTextClass();
					this._rerenderTabs();
				}, 100);
			}),
			this._splitView.sashes[0].onDidEnd(e => {
				window.clearInterval(interval);
				interval = 0;
			})
		];
	}

	private _removeSashListener() {
		if (this._sashDisposables) {
			dispose(this._sashDisposables);
			this._sashDisposables = undefined;
		}
	}

	layout(width: number, height: number): void {
		this._height = height;
		this._width = width;
		this._refreshHasTextClass();
		this._splitView.layout(width);
		if (this._showTabs) {
			this._splitView.resizeView(this._tabTreeIndex, this._getLastWidgetWidth());
		}
	}

	private _refreshHasTextClass() {
		this._tabTreeContainer.classList.toggle('has-text', this._tabTreeContainer.clientWidth > MIDPOINT_WIDGET_WIDTH);
	}

	private _updateTheme(theme?: IColorTheme): void {
		if (!theme) {
			theme = this._themeService.getColorTheme();
		}

		this._findWidget?.updateTheme(theme);
	}

	private _attachEventListeners(parentDomElement: HTMLElement, terminalContainer: HTMLElement): void {
		this._register(dom.addDisposableListener(terminalContainer, 'mousedown', async (event: MouseEvent) => {
			if (this._terminalService.terminalInstances.length === 0) {
				return;
			}

			if (event.which === 2 && isLinux) {
				// Drop selection and focus terminal on Linux to enable middle button paste when click
				// occurs on the selection itself.
				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					terminal.focus();
				}
			} else if (event.which === 3) {
				const rightClickBehavior = this._terminalService.configHelper.config.rightClickBehavior;
				if (rightClickBehavior === 'copyPaste' || rightClickBehavior === 'paste') {
					const terminal = this._terminalService.getActiveInstance();
					if (!terminal) {
						return;
					}

					// copyPaste: Shift+right click should open context menu
					if (rightClickBehavior === 'copyPaste' && event.shiftKey) {
						this._openContextMenu(event, parentDomElement);
						return;
					}

					if (rightClickBehavior === 'copyPaste' && terminal.hasSelection()) {
						await terminal.copySelection();
						terminal.clearSelection();
					} else {
						if (BrowserFeatures.clipboard.readText) {
							terminal.paste();
						} else {
							this._notificationService.info(`This browser doesn't support the clipboard.readText API needed to trigger a paste, try ${isMacintosh ? '⌘' : 'Ctrl'}+V instead.`);
						}
					}
					// Clear selection after all click event bubbling is finished on Mac to prevent
					// right-click selecting a word which is seemed cannot be disabled. There is a
					// flicker when pasting but this appears to give the best experience if the
					// setting is enabled.
					if (isMacintosh) {
						setTimeout(() => {
							terminal.clearSelection();
						}, 0);
					}
					this._cancelContextMenu = true;
				}
			}
		}));
		this._register(dom.addDisposableListener(this._terminalContainer, 'contextmenu', (event: MouseEvent) => {
			if (!this._cancelContextMenu) {
				this._openContextMenu(event, this._terminalContainer);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(this._tabTreeContainer, 'contextmenu', (event: MouseEvent) => {
			if (!this._cancelContextMenu) {
				this._openContextMenu(event, this._tabTreeContainer);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(document, 'keydown', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(document, 'keyup', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'keyup', (event: KeyboardEvent) => {
			if (event.keyCode === 27) {
				// Keep terminal open on escape
				event.stopPropagation();
			}
		}));
		this._register(dom.addDisposableListener(parentDomElement, dom.EventType.DROP, async (e: DragEvent) => {
			if (e.target === this._parentElement || dom.isAncestor(e.target as HTMLElement, parentDomElement)) {
				if (!e.dataTransfer) {
					return;
				}

				// Check if files were dragged from the tree explorer
				let path: string | undefined;
				const resources = e.dataTransfer.getData(DataTransfers.RESOURCES);
				if (resources) {
					path = URI.parse(JSON.parse(resources)[0]).fsPath;
				} else if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].path /* Electron only */) {
					// Check if the file was dragged from the filesystem
					path = URI.file(e.dataTransfer.files[0].path).fsPath;
				}

				if (!path) {
					return;
				}

				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					const preparedPath = await this._terminalService.preparePathForTerminalAsync(path, terminal.shellLaunchConfig.executable, terminal.title, terminal.shellType);
					terminal.sendText(preparedPath, false);
					terminal.focus();
				}
			}
		}));
	}

	private _openContextMenu(event: MouseEvent, parent: HTMLElement): void {
		const standardEvent = new StandardMouseEvent(event);

		const anchor: { x: number, y: number } = { x: standardEvent.posx, y: standardEvent.posy };
		const actions: IAction[] = [];
		let menu: IMenu;
		if (parent === this._terminalContainer) {
			menu = this._instanceMenu;
		} else {
			menu = this._tabsWidget.getFocus().length === 0 ? this._tabsWidgetEmptyMenu : this._tabsWidgetMenu;
		}

		const actionsDisposable = createAndFillInContextMenuActions(menu, undefined, actions);

		// TODO: Convert to command?
		if (menu === this._tabsWidgetEmptyMenu) {
			actions.push(...this._getTabActions());
		}

		this._contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => this._parentElement,
			onHide: () => actionsDisposable.dispose()
		});
	}

	private _getTabActions(): Action[] {
		return [
			new Separator(),
			this._configurationService.inspect('terminal.integrated.tabsLocation').userValue === 'left' ?
				new Action('moveRight', 'Move Tabs Right', undefined, undefined, async () => {
					this._configurationService.updateValue('terminal.integrated.tabsLocation', 'right');
				}) :
				new Action('moveLeft', 'Move Tabs Left', undefined, undefined, async () => {
					this._configurationService.updateValue('terminal.integrated.tabsLocation', 'left');
				}),
			new Action('hideTabs', 'Hide View', undefined, undefined, async () => {
				this._configurationService.updateValue('terminal.integrated.showTabs', false);
			})
		];
	}

	public focusFindWidget() {
		this._findWidgetVisible.set(true);
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance && activeInstance.hasSelection() && activeInstance.selection!.indexOf('\n') === -1) {
			this._findWidget!.reveal(activeInstance.selection);
		} else {
			this._findWidget!.reveal();
		}
	}

	public hideFindWidget() {
		this._findWidgetVisible.reset();
		this.focus();
		this._findWidget!.hide();
	}

	public showFindWidget() {
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance && activeInstance.hasSelection() && activeInstance.selection!.indexOf('\n') === -1) {
			this._findWidget!.show(activeInstance.selection);
		} else {
			this._findWidget!.show();
		}
	}

	public getFindWidget(): TerminalFindWidget {
		return this._findWidget!;
	}
	public focus() {
		if (this._terminalService.connectionState === TerminalConnectionState.Connecting) {
			// If the terminal is waiting to reconnect to remote terminals, then there is no TerminalInstance yet that can
			// be focused. So wait for connection to finish, then focus.
			const activeElement = document.activeElement;
			this._register(this._terminalService.onDidChangeConnectionState(() => {
				// Only focus the terminal if the activeElement has not changed since focus() was called
				// TODO hack
				if (document.activeElement === activeElement) {
					this._focus();
				}
			}));

			return;
		}
		this._focus();
	}

	private _focus() {
		this._terminalService.getActiveInstance()?.focusWhenReady();
	}
}
