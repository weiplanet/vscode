/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, Dimension, EventHelper } from 'vs/base/browser/dom';
import { ButtonBar } from 'vs/base/browser/ui/button/button';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { Action } from 'vs/base/common/actions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Codicon, registerCodicon } from 'vs/base/common/codicons';
import { Color, RGBA } from 'vs/base/common/color';
import { debounce } from 'vs/base/common/decorators';
import { Iterable } from 'vs/base/common/iterator';
import { splitName } from 'vs/base/common/labels';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { parseLinkedText } from 'vs/base/common/linkedText';
import { Schemas } from 'vs/base/common/network';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { isArray } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ExtensionUntrustedWorkpaceSupportType } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IPromptChoiceWithMenu, Severity } from 'vs/platform/notification/common/notification';
import { Link } from 'vs/platform/opener/browser/link';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { foreground } from 'vs/platform/theme/common/colorRegistry';
import { attachButtonStyler, attachLinkStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IColorTheme, ICssStyleCollector, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { isSingleFolderWorkspaceIdentifier, toWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { EditorOptions, IEditorOpenContext } from 'vs/workbench/common/editor';
import { ChoiceAction } from 'vs/workbench/common/notifications';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { getInstalledExtensions, IExtensionStatus } from 'vs/workbench/contrib/extensions/common/extensionsUtils';
import { trustedForegroundColor, untrustedForegroundColor } from 'vs/workbench/contrib/workspace/browser/workspaceTrustColors';
import { IWorkspaceTrustSettingChangeEvent, WorkspaceTrustSettingArrayRenderer, WorkspaceTrustTree, WorkspaceTrustTreeModel } from 'vs/workbench/contrib/workspace/browser/workspaceTrustTree';
import { filterSettingsRequireWorkspaceTrust, IWorkbenchConfigurationService } from 'vs/workbench/services/configuration/common/configuration';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';
import { WorkspaceTrustEditorInput } from 'vs/workbench/services/workspaces/browser/workspaceTrustEditorInput';

const untrustedIcon = registerCodicon('workspace-untrusted-icon', Codicon.workspaceUntrusted);
const trustedIcon = registerCodicon('workspace-trusted-icon', Codicon.workspaceTrusted);

const checkListIcon = registerCodicon('workspace-trusted-check-icon', Codicon.check);
const xListIcon = registerCodicon('workspace-trusted-x-icon', Codicon.x);

export class WorkspaceTrustEditor extends EditorPane {
	static readonly ID: string = 'workbench.editor.workspaceTrust';
	private rootElement!: HTMLElement;

	// Header Section
	private headerContainer!: HTMLElement;
	private headerTitleContainer!: HTMLElement;
	private headerTitleIcon!: HTMLElement;
	private headerTitleText!: HTMLElement;
	private headerDescription!: HTMLElement;

	private bodyScrollBar!: DomScrollableElement;

	// Affected Features Section
	private affectedFeaturesContainer!: HTMLElement;

	// Settings Section
	private configurationContainer!: HTMLElement;
	private trustSettingsTree!: WorkspaceTrustTree;
	private workspaceTrustSettingsTreeModel!: WorkspaceTrustTreeModel;


	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IExtensionsWorkbenchService private readonly extensionWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionManifestPropertiesService private readonly extensionManifestPropertiesService: IExtensionManifestPropertiesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkbenchConfigurationService private readonly configurationService: IWorkbenchConfigurationService,
	) { super(WorkspaceTrustEditor.ID, telemetryService, themeService, storageService); }

	protected createEditor(parent: HTMLElement): void {
		this.rootElement = append(parent, $('.workspace-trust-editor', { tabindex: '-1' }));

		this.createHeaderElement(this.rootElement);

		const scrollableContent = $('.workspace-trust-editor-body');
		this.bodyScrollBar = this._register(new DomScrollableElement(scrollableContent, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Visible,
		}));

		append(this.rootElement, this.bodyScrollBar.getDomNode());

		this.createAffectedFeaturesElement(scrollableContent);
		this.createConfigurationElement(scrollableContent);

		this._register(attachStylerCallback(this.themeService, { trustedForegroundColor, untrustedForegroundColor }, colors => {
			this.rootElement.style.setProperty('--workspace-trust-state-trusted-color', colors.trustedForegroundColor?.toString() || '');
			this.rootElement.style.setProperty('--workspace-trust-state-untrusted-color', colors.untrustedForegroundColor?.toString() || '');
		}));

		this._register(registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
			const foregroundColor = theme.getColor(foreground);
			if (foregroundColor) {
				const fgWithOpacity = new Color(new RGBA(foregroundColor.rgba.r, foregroundColor.rgba.g, foregroundColor.rgba.b, 0.3));
				collector.addRule(`.workspace-trust-editor .workspace-trust-features .workspace-trust-limitations { border: 1px solid ${fgWithOpacity}; margin: 0px 4px; display: flex; flex-direction: column; padding: 10px 40px;}`);
			}
		}));
	}

	override async setInput(input: WorkspaceTrustEditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {

		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }

		this.registerListeners();
		this.render();
	}

	private registerListeners(): void {
		this._register(this.extensionWorkbenchService.onChange(() => this.render()));
		this._register(this.configurationService.onDidChangeUntrustdSettings(() => this.render()));
		this._register(this.workspaceTrustManagementService.onDidChangeTrust(() => this.render()));
		this._register(this.workspaceTrustManagementService.onDidChangeTrustedFolders(() => this.render()));
	}

	private getHeaderContainerClass(trusted: boolean): string {
		if (trusted) {
			return 'workspace-trust-header workspace-trust-trusted';
		}

		return 'workspace-trust-header workspace-trust-untrusted';
	}

	private getHeaderTitleText(trusted: boolean): string {
		if (trusted) {
			return localize('trustedHeader', "This workspace is trusted");
		}

		return localize('untrustedHeader', "This workspace is not trusted");
	}

	private getHeaderDescriptionText(trusted: boolean): string {
		if (trusted) {
			return localize('trustedDescription', "All features are enabled because trust has been granted to the workspace. [Learn more](https://aka.ms/vscode-workspace-trust).");
		}

		return localize('untrustedDescription', "Some features are disabled until trust is granted to the workspace. [Learn more](https://aka.ms/vscode-workspace-trust).");
	}

	private getHeaderTitleIconClassNames(trusted: boolean): string[] {
		if (trusted) {
			return trustedIcon.classNamesArray;
		}

		return untrustedIcon.classNamesArray;
	}

	private rendering = false;
	private rerenderDisposables: DisposableStore = this._register(new DisposableStore());
	@debounce(100)
	private async render() {
		if (this.rendering) {
			return;
		}

		this.rendering = true;
		this.rerenderDisposables.clear();

		const isWorkspaceTrusted = this.workspaceTrustManagementService.isWorkpaceTrusted();
		this.rootElement.classList.toggle('trusted', isWorkspaceTrusted);
		this.rootElement.classList.toggle('untrusted', !isWorkspaceTrusted);

		// Header Section
		this.headerTitleText.innerText = this.getHeaderTitleText(isWorkspaceTrusted);
		this.headerTitleIcon.className = 'workspace-trust-title-icon';
		this.headerTitleIcon.classList.add(...this.getHeaderTitleIconClassNames(isWorkspaceTrusted));
		this.headerDescription.innerText = '';

		const linkedText = parseLinkedText(this.getHeaderDescriptionText(isWorkspaceTrusted));
		const p = append(this.headerDescription, $('p'));
		for (const node of linkedText.nodes) {
			if (typeof node === 'string') {
				append(p, document.createTextNode(node));
			} else {
				const link = this.instantiationService.createInstance(Link, node);
				append(p, link.el);
				this.rerenderDisposables.add(link);
				this.rerenderDisposables.add(attachLinkStyler(link, this.themeService));
			}
		}

		this.headerContainer.className = this.getHeaderContainerClass(isWorkspaceTrusted);

		// Settings
		const settingsRequiringTrustedWorkspaceCount = filterSettingsRequireWorkspaceTrust(this.configurationService.unTrustedSettings.default).length;

		// Features List
		const installedExtensions = await this.instantiationService.invokeFunction(getInstalledExtensions);
		const onDemandExtensionCount = this.getExtensionCountByUntrustedWorkspaceSupport(installedExtensions, 'limited');
		const onStartExtensionCount = this.getExtensionCountByUntrustedWorkspaceSupport(installedExtensions, false);

		this.renderAffectedFeatures(settingsRequiringTrustedWorkspaceCount, onDemandExtensionCount + onStartExtensionCount);

		// Configuration Tree
		this.workspaceTrustSettingsTreeModel.update(this.workspaceTrustManagementService.getTrustedFolders());
		this.trustSettingsTree.setChildren(null, Iterable.map(this.workspaceTrustSettingsTreeModel.settings, s => { return { element: s }; }));

		this.bodyScrollBar.getDomNode().style.height = `calc(100% - ${this.headerContainer.clientHeight}px)`;
		this.bodyScrollBar.scanDomNode();
		this.rendering = false;
	}

	private getExtensionCountByUntrustedWorkspaceSupport(extensions: IExtensionStatus[], trustRequestType: ExtensionUntrustedWorkpaceSupportType): number {
		const filtered = extensions.filter(ext => this.extensionManifestPropertiesService.getExtensionUntrustedWorkspaceSupportType(ext.local.manifest) === trustRequestType);
		const set = new Set<string>();
		for (const ext of filtered) {
			set.add(ext.identifier.id);
		}

		return set.size;
	}

	private createHeaderElement(parent: HTMLElement): void {
		this.headerContainer = append(parent, $('.workspace-trust-header'));
		this.headerTitleContainer = append(this.headerContainer, $('.workspace-trust-title'));
		this.headerTitleIcon = append(this.headerTitleContainer, $('.workspace-trust-title-icon'));
		this.headerTitleText = append(this.headerTitleContainer, $('.workspace-trust-title-text'));
		this.headerDescription = append(this.headerContainer, $('.workspace-trust-description'));
	}

	private createConfigurationElement(parent: HTMLElement): void {
		this.configurationContainer = append(parent, $('.workspace-trust-settings.settings-editor'));

		const settingsBody = append(this.configurationContainer, $('.workspace-trust-settings-body.settings-body'));

		const workspaceTrustTreeContainer = append(settingsBody, $('.workspace-trust-settings-tree-container.settings-tree-container'));
		const renderer = this.instantiationService.createInstance(WorkspaceTrustSettingArrayRenderer,);

		this.trustSettingsTree = this._register(this.instantiationService.createInstance(WorkspaceTrustTree,
			workspaceTrustTreeContainer,
			[renderer]));

		this.workspaceTrustSettingsTreeModel = this.instantiationService.createInstance(WorkspaceTrustTreeModel);

		this._register(renderer.onDidChangeSetting(e => this.onDidChangeSetting(e)));
	}

	private createAffectedFeaturesElement(parent: HTMLElement): void {
		this.affectedFeaturesContainer = append(parent, $('.workspace-trust-features'));
	}

	private renderAffectedFeatures(numSettings: number, numExtensions: number): void {
		clearNode(this.affectedFeaturesContainer);
		const trustedContainer = append(this.affectedFeaturesContainer, $('.workspace-trust-limitations.trusted'));
		this.renderLimitationsHeaderElement(trustedContainer, localize('trustedWorkspace', "Trusted Workspace"), this.getHeaderTitleIconClassNames(true));
		this.renderLimitationsListElement(trustedContainer, [
			localize('trustedTasks', "Tasks will be allowed to run"),
			localize('trustedDebugging', "Debugging will be enabled"),
			localize('trustedSettings', "All workspace settings will be applied"),
			localize('trustedExtensions', "All extensions will be enabled")
		], checkListIcon.classNamesArray);

		const untrustedContainer = append(this.affectedFeaturesContainer, $('.workspace-trust-limitations.untrusted'));
		this.renderLimitationsHeaderElement(untrustedContainer, localize('untrustedWorkspace', "Untrusted Workspace"), this.getHeaderTitleIconClassNames(false));

		this.renderLimitationsListElement(untrustedContainer, [
			localize('untrustedTasks', "Tasks will be disabled"),
			localize('untrustedDebugging', "Debugging will be disabled"),
			numSettings ? localize('untrustedSettings', "[{0} workspace settings](command:{1}) will not be applied", numSettings, 'settings.filterUntrusted') : localize('no untrustedSettings', "Workspace settings requiring trust will not be applied."),
			localize('untrustedExtensions', "[{0} extensions](command:{1}) will be disabled or limit functionality", numExtensions, 'workbench.extensions.action.listTrustRequiredExtensions')
		], xListIcon.classNamesArray);

		this.addTrustButtonToElement(trustedContainer);
		this.addUntrustedTextToElement(untrustedContainer);
	}

	private addTrustButtonToElement(parent: HTMLElement): void {
		if (this.workspaceTrustManagementService.canSetWorkspaceTrust()) {
			const buttonRow = append(parent, $('.workspace-trust-buttons-row'));
			const buttonContainer = append(buttonRow, $('.workspace-trust-buttons'));
			const buttonBar = this.rerenderDisposables.add(new ButtonBar(buttonContainer));

			const createButton = (action: Action, enabled?: boolean) => {
				const button =
					action instanceof ChoiceAction && action.menu?.length ?
						buttonBar.addButtonWithDropdown({
							title: true,
							actions: action.menu ?? [],
							contextMenuProvider: this.contextMenuService
						}) :
						buttonBar.addButton();

				button.label = action.label;
				button.enabled = enabled !== undefined ? enabled : action.enabled;

				this.rerenderDisposables.add(button.onDidClick(e => {
					if (e) {
						EventHelper.stop(e, true);
					}

					action.run();
				}));

				this.rerenderDisposables.add(attachButtonStyler(button, this.themeService));
			};

			const trustUris = async (uris?: URI[]) => {
				if (!uris) {
					this.workspaceTrustManagementService.setWorkspaceTrust(true);
				} else {
					this.workspaceTrustManagementService.setFoldersTrust(uris, true);
				}
			};

			const trustChoiceWithMenu: IPromptChoiceWithMenu = {
				isSecondary: false,
				label: localize('trustButton', "Trust"),
				menu: [],
				run: () => {
					trustUris();
				}
			};

			const workspaceIdentifier = toWorkspaceIdentifier(this.workspaceService.getWorkspace());
			if (isSingleFolderWorkspaceIdentifier(workspaceIdentifier) && workspaceIdentifier.uri.scheme === Schemas.file) {
				const { parentPath } = splitName(workspaceIdentifier.uri.fsPath);
				const { name } = splitName(parentPath);
				if (parentPath) {
					trustChoiceWithMenu.menu.push({
						label: localize('trustParentButton', "Trust All in '{0}'", name),
						run: () => {
							trustUris([URI.file(parentPath)]);
						}
					});
				}
			}

			const isWorkspaceTrusted = this.workspaceTrustManagementService.isWorkpaceTrusted();
			createButton(new ChoiceAction('workspace.trust.button.action', trustChoiceWithMenu), !isWorkspaceTrusted);
		}
	}

	private addUntrustedTextToElement(parent: HTMLElement): void {
		const isWorkspaceTrusted = this.workspaceTrustManagementService.isWorkpaceTrusted();
		const canSetWorkspaceTrust = this.workspaceTrustManagementService.canSetWorkspaceTrust();

		if (canSetWorkspaceTrust && isWorkspaceTrusted) {
			const textElement = append(parent, $('.workspace-trust-untrusted-description'));
			textElement.innerText = localize('untrustedFolder', "This workspace is trusted via one or more of the trusted folders below.");
		}
	}

	private renderLimitationsHeaderElement(parent: HTMLElement, headerText: string, iconClassNames: string[]): void {
		const limitationsHeaderContainer = append(parent, $('.workspace-trust-limitations-header'));
		const titleElement = append(limitationsHeaderContainer, $('.workspace-trust-limitations-title'));
		const iconElement = append(titleElement, $('.workspace-trust-limitations-title-icon'));
		const textElement = append(titleElement, $('.workspace-trust-limitations-title-text'));

		textElement.innerText = headerText;
		iconElement.className = 'workspace-trust-title-icon';
		iconElement.classList.add(...iconClassNames);
	}

	private renderLimitationsListElement(parent: HTMLElement, limitations: string[], iconClassNames: string[]): void {
		const listContainer = append(parent, $('.workspace-trust-limitations-list-container'));
		const limitationsList = append(listContainer, $('ul'));
		for (const limitation of limitations) {
			const limitationListItem = append(limitationsList, $('li'));
			const icon = append(limitationListItem, $('.list-item-icon'));
			const text = append(limitationListItem, $('.list-item-text'));

			icon.classList.add(...iconClassNames);

			const linkedText = parseLinkedText(limitation);
			for (const node of linkedText.nodes) {
				if (typeof node === 'string') {
					append(text, document.createTextNode(node));
				} else {
					const link = this.instantiationService.createInstance(Link, node);
					append(text, link.el);
					this.rerenderDisposables.add(link);
					this.rerenderDisposables.add(attachLinkStyler(link, this.themeService));
				}
			}
		}
	}

	private onDidChangeSetting(change: IWorkspaceTrustSettingChangeEvent) {
		const applyChangesWithPrompt = async (showPrompt: boolean, applyChanges: () => void) => {
			if (showPrompt) {
				const message = localize('workspaceTrustSettingModificationMessage', "Update Workspace Trust Settings");
				const detail = localize('workspaceTrustTransitionDetail', "In order to safely complete this action, all affected windows will have to be reloaded. Are you sure you want to proceed with this action?");
				const primaryButton = localize('workspaceTrustTransitionPrimaryButton', "Yes");
				const secondaryButton = localize('workspaceTrustTransitionSecondaryButton', "No");

				const result = await this.dialogService.show(Severity.Info, message, [primaryButton, secondaryButton], { cancelId: 1, detail, custom: { icon: Codicon.shield } });
				if (result.choice !== 0) {
					return;
				}
			}

			applyChanges();
		};

		if (isArray(change.value)) {
			if (change.key === 'trustedFolders') {
				applyChangesWithPrompt(false, () => this.workspaceTrustManagementService.setTrustedFolders(change.value!));
			}
		}
	}

	private layoutParticipants: { layout: () => void; }[] = [];
	layout(dimension: Dimension): void {
		if (!this.isVisible()) {
			return;
		}

		this.trustSettingsTree.layout(dimension.height, dimension.width);

		this.layoutParticipants.forEach(participant => {
			participant.layout();
		});

		this.bodyScrollBar.scanDomNode();
	}
}
