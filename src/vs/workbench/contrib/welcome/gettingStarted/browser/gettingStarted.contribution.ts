/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { GettingStartedInputSerializer, GettingStartedPage, inGettingStartedContext } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStarted';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorExtensions, Extensions as EditorInputExtensions, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ContextKeyEqualsExpr } from 'vs/platform/contextkey/common/contextkey';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode } from 'vs/base/common/keyCodes';
import { EditorDescriptor, IEditorRegistry } from 'vs/workbench/browser/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IGettingStartedService } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedService';
import { GettingStartedInput } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedInput';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

export * as icons from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedIcons';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.showGettingStarted',
			title: localize('Getting Started', "Getting Started"),
			category: localize('help', "Help"),
			f1: true,
			menu: {
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 2,
			}
		});
	}

	public run(accessor: ServicesAccessor) {
		accessor.get(IEditorService).openEditor(new GettingStartedInput({}), {});
	}
});

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputSerializer(GettingStartedInput.ID, GettingStartedInputSerializer);
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		GettingStartedPage,
		GettingStartedPage.ID,
		localize('gettingStarted', "Getting Started")
	),
	[
		new SyncDescriptor(GettingStartedInput)
	]
);

const category = localize('gettingStarted', "Getting Started");

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'gettingStarted.goBack',
			title: localize('gettingStarted.goBack', "Go Back"),
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape,
				when: inGettingStartedContext
			},
			precondition: ContextKeyEqualsExpr.create('activeEditor', 'gettingStartedPage'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.escape();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'gettingStarted.next',
			title: localize('gettingStarted.goNext', "Next"),
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.DownArrow,
				secondary: [KeyCode.RightArrow],
				when: inGettingStartedContext
			},
			precondition: ContextKeyEqualsExpr.create('activeEditor', 'gettingStartedPage'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.focusNext();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'gettingStarted.prev',
			title: localize('gettingStarted.goPrev', "Previous"),
			category,
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.UpArrow,
				secondary: [KeyCode.LeftArrow],
				when: inGettingStartedContext
			},
			precondition: ContextKeyEqualsExpr.create('activeEditor', 'gettingStartedPage'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const editorPane = editorService.activeEditorPane;
		if (editorPane instanceof GettingStartedPage) {
			editorPane.focusPrevious();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'gettingStarted.markTaskComplete',
			title: localize('gettingStarted.markTaskComplete', "Mark Task Complete"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IGettingStartedService);
		gettingStartedService.progressTask(arg);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'gettingStarted.markTaskIncomplete',
			title: localize('gettingStarted.markTaskInomplete', "Mark Task Incomplete"),
			category,
		});
	}

	run(accessor: ServicesAccessor, arg: string) {
		if (!arg) { return; }
		const gettingStartedService = accessor.get(IGettingStartedService);
		gettingStartedService.deprogressTask(arg);
	}
});

class WorkbenchConfigurationContribution {
	constructor(
		@IInstantiationService _instantiationService: IInstantiationService,
		@IGettingStartedService _gettingStartedService: IGettingStartedService,
	) {
		// Init the getting started service via DI.
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(WorkbenchConfigurationContribution, LifecyclePhase.Restored);
