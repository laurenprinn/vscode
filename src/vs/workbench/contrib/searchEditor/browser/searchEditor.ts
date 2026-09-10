/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { alert } from '../../../../base/browser/ui/aria/aria.js';
import { Action } from '../../../../base/common/actions.js';
import { Delayer } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Schemas } from '../../../../base/common/network.js';
import { isEqual, joinPath } from '../../../../base/common/resources.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import './media/searchEditor.css';
import { IViewZone, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorWidgetOptions } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { linesDiffComputers } from '../../../../editor/common/diff/linesDiffComputers.js';
import { ICodeEditorViewState, IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { ReferencesController } from '../../../../editor/contrib/gotoSymbol/browser/peek/referencesController.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IEditorProgressService, LongRunningOperation } from '../../../../platform/progress/common/progress.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { inputBorder, registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { AbstractTextCodeEditor } from '../../../browser/parts/editor/textCodeEditor.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ExcludePatternInputWidget, IncludePatternInputWidget } from '../../search/browser/patternInputWidget.js';
import { SearchWidget } from '../../search/browser/searchWidget.js';
import { ITextQueryBuilderOptions, QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { getOutOfWorkspaceEditorResources } from '../../search/common/search.js';
import { SearchModelImpl } from '../../search/browser/searchTreeModel/searchModel.js';
import { ApplyAllSearchEditorResultChangesCommandId, ApplySearchEditorInlineResultChangeCommandId, InSearchEditor, NextSearchEditorInlineResultChangeCommandId, OpenSearchEditorResultsInlineDiffCommandId, PreviousSearchEditorInlineResultChangeCommandId, SearchEditorID, SearchEditorInlineDiffVisible, SearchEditorInputTypeId, SearchConfiguration } from './constants.js';
import type { SearchEditorInput } from './searchEditorInput.js';
import { extractSearchResultSourceLabels, getSearchResultInsertAnchorLineNumber, mergeSearchResultLines, parseSearchResultLines, rebaseSearchResultLines, SearchResultLine, SearchResultSource, serializeSearchResultForEditor } from './searchEditorSerialization.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPatternInfo, ISearchComplete, ISearchConfigurationProperties, ITextQuery, SearchSortOrder } from '../../../services/search/common/search.js';
import { searchDetailsIcon } from '../../search/browser/searchIcons.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { TextSearchCompleteMessage } from '../../../services/search/common/searchExtTypes.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { renderSearchMessage } from '../../search/browser/searchMessage.js';
import { EditorExtensionsRegistry, IEditorContributionDescription } from '../../../../editor/browser/editorExtensions.js';
import { UnusualLineTerminatorsDetector } from '../../../../editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js';
import { defaultToggleStyles, getInputBoxStyle } from '../../../../platform/theme/browser/defaultStyles.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { SearchContext } from '../../search/common/constants.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ISearchResult } from '../../search/browser/searchTreeModel/searchTreeCommon.js';
import { ISearchEditorResultLogService } from './searchEditorResultLogService.js';

const RESULT_LINE_REGEX = /^(\s+)(\d+)[+-]?(: |  )(\s*)(.*)$/;
const FILE_LINE_REGEX = /^(\S.*):$/;
const DEFAULT_QUERY_EDITOR_LAYOUT_OFFSET = 28;

type SearchEditorViewState = ICodeEditorViewState & { focused: 'input' | 'editor' };

type SearchEditorResultChangeModel = { resource: URI; originalModel: ITextModel; modifiedModel: ITextModel };

type SearchEditorResultChangeModels = {
	sourceReferences: DisposableStore;
	previewModels: DisposableStore;
	synchronizedPreviewModels: SearchEditorResultChangeModel[];
};

type SearchEditorInlineDiff = {
	decorations: IModelDeltaDecoration[];
	previews: { afterLineNumber: number; sourceText?: string; mergedText?: string }[];
};

export class SearchEditor extends AbstractTextCodeEditor<SearchEditorViewState> {
	static readonly ID: string = SearchEditorID;

	static readonly SEARCH_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'searchEditorViewState';

	private queryEditorWidget!: SearchWidget;
	private get searchResultEditor() { return this.editorControl!; }
	private queryEditorContainer!: HTMLElement;
	private inlineResultsDiffDecorations!: IEditorDecorationsCollection;
	private resultChangesDecorations!: IEditorDecorationsCollection;
	private inlineDiffVisibleContextKey!: IContextKey<boolean>;
	private dimension?: DOM.Dimension;
	private inputPatternIncludes!: IncludePatternInputWidget;
	private inputPatternExcludes!: ExcludePatternInputWidget;
	private includesExcludesContainer!: HTMLElement;
	private toggleQueryDetailsButton!: HTMLElement;
	private messageBox!: HTMLElement;
	private unappliedChangesStatus!: HTMLElement;

	private runSearchDelayer = this._register(new Delayer(0));
	private pauseSearching: boolean = false;
	private showingIncludesExcludes: boolean = false;
	private searchOperation: LongRunningOperation;
	private searchHistoryDelayer: Delayer<void>;
	private resultsDiffDelayer = this._register(new Delayer<void>(200));
	private readonly messageDisposables: DisposableStore;
	private container: HTMLElement;
	private searchModel: SearchModelImpl;
	private ongoingOperations: number = 0;
	private updatingModelForSearch: boolean = false;
	private openResultsInlineDiffAction!: Action;
	private previousInlineResultChangeAction!: Action;
	private nextInlineResultChangeAction!: Action;
	private applyAllResultChangesAction!: Action;
	private readonly inlineResultsDiffSession = this._register(new MutableDisposable<DisposableStore>());
	private readonly resultChangesSourceSession = this._register(new MutableDisposable<DisposableStore>());
	private readonly inlineResultChanges = new Map<number, { resource: URI; text: string }>();
	private inlineResultsDiffViewZoneIds: string[] = [];
	private inlineResultsDiffPreviousGlyphMargin: boolean | undefined;
	private showingInlineResultsDiff = false;
	private resultsDiffUpdate = 0;
	private confirmedUnappliedChanges: { input: SearchEditorInput; versionId: number } | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IModelService private readonly modelService: IModelService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorProgressService progressService: IEditorProgressService,
		@ITextResourceConfigurationService textResourceService: ITextResourceConfigurationService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IHoverService private readonly hoverService: IHoverService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ISearchEditorResultLogService private readonly searchEditorResultLogService: ISearchEditorResultLogService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(SearchEditor.ID, group, telemetryService, instantiationService, storageService, textResourceService, themeService, editorService, editorGroupService, fileService);
		this.container = DOM.$('.search-editor');

		this.searchOperation = this._register(new LongRunningOperation(progressService));
		this._register(this.messageDisposables = new DisposableStore());

		this.searchHistoryDelayer = this._register(new Delayer<void>(2000));

		this.searchModel = this._register(this.instantiationService.createInstance(SearchModelImpl));
	}

	protected override createEditor(parent: HTMLElement) {
		DOM.append(parent, this.container);
		this.queryEditorContainer = DOM.append(this.container, DOM.$('.query-container'));
		const searchResultContainer = DOM.append(this.container, DOM.$('.search-results'));
		super.createEditor(searchResultContainer);
		this.inlineResultsDiffDecorations = this.searchResultEditor.createDecorationsCollection();
		this.resultChangesDecorations = this.searchResultEditor.createDecorationsCollection();
		this._register(this.searchResultEditor.onMouseDown(event => {
			const lineNumber = event.target.range?.startLineNumber;
			if (event.event.leftButton && event.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN && lineNumber !== undefined && this.inlineResultChanges.has(lineNumber)) {
				event.event.preventDefault();
				event.event.stopPropagation();
				void this.commandService.executeCommand(ApplySearchEditorInlineResultChangeCommandId, lineNumber);
			}
		}));
		this.registerEditorListeners();

		const scopedContextKeyService = assertReturnsDefined(this.scopedContextKeyService);
		InSearchEditor.bindTo(scopedContextKeyService).set(true);
		this.inlineDiffVisibleContextKey = SearchEditorInlineDiffVisible.bindTo(scopedContextKeyService);

		this.createQueryEditor(
			this.queryEditorContainer,
			this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService]))),
			SearchContext.InputBoxFocusedKey.bindTo(scopedContextKeyService)
		);
	}


	private createQueryEditor(container: HTMLElement, scopedInstantiationService: IInstantiationService, inputBoxFocusedContextKey: IContextKey<boolean>) {
		const searchEditorInputboxStyles = getInputBoxStyle({ inputBorder: searchEditorTextInputBorder });
		this.openResultsInlineDiffAction = this._register(new Action(
			OpenSearchEditorResultsInlineDiffCommandId,
			this.keybindingService.appendKeybinding(localize('searchEditor.openResultsInlineDiff', "View Inline Changes"), OpenSearchEditorResultsInlineDiffCommandId),
			ThemeIcon.asClassName(Codicon.diffSingle),
			false,
			() => this.toggleResultsInlineDiff()
		));
		this.previousInlineResultChangeAction = this._register(new Action(
			PreviousSearchEditorInlineResultChangeCommandId,
			this.keybindingService.appendKeybinding(localize('searchEditor.previousInlineResultChange', "Previous Inline Change"), PreviousSearchEditorInlineResultChangeCommandId),
			ThemeIcon.asClassName(Codicon.arrowUp),
			false,
			() => this.commandService.executeCommand(PreviousSearchEditorInlineResultChangeCommandId)
		));
		this.nextInlineResultChangeAction = this._register(new Action(
			NextSearchEditorInlineResultChangeCommandId,
			this.keybindingService.appendKeybinding(localize('searchEditor.nextInlineResultChange', "Next Inline Change"), NextSearchEditorInlineResultChangeCommandId),
			ThemeIcon.asClassName(Codicon.arrowDown),
			false,
			() => this.commandService.executeCommand(NextSearchEditorInlineResultChangeCommandId)
		));
		this.applyAllResultChangesAction = this._register(new Action(
			ApplyAllSearchEditorResultChangesCommandId,
			this.keybindingService.appendKeybinding(localize('searchEditor.applyAllResultChanges', "Apply All Changes"), ApplyAllSearchEditorResultChangesCommandId),
			ThemeIcon.asClassName(Codicon.checkAll),
			false,
			() => this.commandService.executeCommand(ApplyAllSearchEditorResultChangesCommandId)
		));

		this.queryEditorWidget = this._register(scopedInstantiationService.createInstance(SearchWidget, container, { _hideReplaceToggle: true, showContextToggle: true, additionalSearchInputActions: [this.openResultsInlineDiffAction, this.previousInlineResultChangeAction, this.nextInlineResultChangeAction, this.applyAllResultChangesAction], inputBoxStyles: searchEditorInputboxStyles, toggleStyles: defaultToggleStyles }));
		this.unappliedChangesStatus = DOM.append(container, DOM.$('.search-editor-unapplied-changes-status', { role: 'status', 'aria-live': 'polite' }));
		this.unappliedChangesStatus.hidden = true;
		this._register(this.queryEditorWidget.onReplaceToggled(() => this.reLayout()));
		this._register(this.queryEditorWidget.onDidHeightChange(() => this.reLayout()));
		this._register(this.queryEditorWidget.onSearchSubmit(({ delay }) => this.triggerSearch({ delay })));
		if (this.queryEditorWidget.searchInput) {
			this._register(this.queryEditorWidget.searchInput.onDidOptionChange(() => this.triggerSearch({ resetCursor: false })));
		} else {
			this.logService.warn('SearchEditor: SearchWidget.searchInput is undefined, cannot register onDidOptionChange listener');
		}
		this._register(this.queryEditorWidget.onDidToggleContext(() => this.triggerSearch({ resetCursor: false })));

		// Includes/Excludes Dropdown
		this.includesExcludesContainer = DOM.append(container, DOM.$('.includes-excludes'));

		// Toggle query details button
		const toggleQueryDetailsLabel = localize('moreSearch', "Toggle Search Details");
		this.toggleQueryDetailsButton = DOM.append(this.includesExcludesContainer, DOM.$('.expand' + ThemeIcon.asCSSSelector(searchDetailsIcon), { tabindex: 0, role: 'button', 'aria-label': toggleQueryDetailsLabel }));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this.toggleQueryDetailsButton, toggleQueryDetailsLabel));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.CLICK, e => {
			DOM.EventHelper.stop(e);
			this.toggleIncludesExcludes();
		}));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				DOM.EventHelper.stop(e);
				this.toggleIncludesExcludes();
			}
		}));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyMod.Shift | KeyCode.Tab)) {
				if (this.queryEditorWidget.isReplaceActive()) {
					this.queryEditorWidget.focusReplaceAllAction();
				}
				else {
					this.queryEditorWidget.isReplaceShown() ? this.queryEditorWidget.replaceInput?.focusOnPreserve() : this.queryEditorWidget.focusRegexAction();
				}
				DOM.EventHelper.stop(e);
			}
		}));

		// Includes
		const folderIncludesList = DOM.append(this.includesExcludesContainer, DOM.$('.file-types.includes'));
		const filesToIncludeTitle = localize('searchScope.includes', "files to include");
		DOM.append(folderIncludesList, DOM.$('h4', undefined, filesToIncludeTitle));
		this.inputPatternIncludes = this._register(scopedInstantiationService.createInstance(IncludePatternInputWidget, folderIncludesList, this.contextViewService, {
			ariaLabel: localize('label.includes', 'Search Include Patterns'),
			inputBoxStyles: searchEditorInputboxStyles
		}));
		this._register(this.inputPatternIncludes.onSubmit(triggeredOnType => this.triggerSearch({ resetCursor: false, delay: triggeredOnType ? this.searchConfig.searchOnTypeDebouncePeriod : 0 })));
		this._register(this.inputPatternIncludes.onChangeSearchInEditorsBox(() => this.triggerSearch()));

		// Excludes
		const excludesList = DOM.append(this.includesExcludesContainer, DOM.$('.file-types.excludes'));
		const excludesTitle = localize('searchScope.excludes', "files to exclude");
		DOM.append(excludesList, DOM.$('h4', undefined, excludesTitle));
		this.inputPatternExcludes = this._register(scopedInstantiationService.createInstance(ExcludePatternInputWidget, excludesList, this.contextViewService, {
			ariaLabel: localize('label.excludes', 'Search Exclude Patterns'),
			inputBoxStyles: searchEditorInputboxStyles
		}));
		this._register(this.inputPatternExcludes.onSubmit(triggeredOnType => this.triggerSearch({ resetCursor: false, delay: triggeredOnType ? this.searchConfig.searchOnTypeDebouncePeriod : 0 })));
		this._register(this.inputPatternExcludes.onChangeIgnoreBox(() => this.triggerSearch()));

		// Messages
		this.messageBox = DOM.append(container, DOM.$('.messages.text-search-provider-messages'));

		[this.queryEditorWidget.searchInputFocusTracker, this.queryEditorWidget.replaceInputFocusTracker, this.inputPatternExcludes.inputFocusTracker, this.inputPatternIncludes.inputFocusTracker]
			.forEach(tracker => {
				if (!tracker) {
					return;
				}
				this._register(tracker.onDidFocus(() => setTimeout(() => inputBoxFocusedContextKey.set(true), 0)));
				this._register(tracker.onDidBlur(() => inputBoxFocusedContextKey.set(false)));
			});
	}

	async toggleResultsInlineDiff(): Promise<void> {
		if (this.showingInlineResultsDiff) {
			this.hideResultsInlineDiff();
			return;
		}

		const input = this.getInput();
		const resultsModel = this.searchResultEditor.getModel();
		if (!input || !resultsModel) {
			return;
		}

		const diffModels = await this.createResultChangeModels(input, resultsModel);
		const changedModels = diffModels.synchronizedPreviewModels.filter(model => model.originalModel.getValue() !== model.modifiedModel.getValue());
		if (changedModels.length === 0) {
			diffModels.previewModels.dispose();
			diffModels.sourceReferences.dispose();
			this.notificationService.info(localize('searchEditor.noResultChanges', "Search results match the current source files."));
			return;
		}

		const session = new DisposableStore();
		session.add(diffModels.sourceReferences);
		session.add(diffModels.previewModels);
		const baselineLines = new ResourceMap<readonly string[]>();
		for (const diffModel of diffModels.synchronizedPreviewModels) {
			baselineLines.set(diffModel.resource, input.getResultBaseline(diffModel.resource) ?? diffModel.originalModel.getLinesContent());
		}
		if (!input.hasResultBaseline()) {
			input.setResultBaseline([...baselineLines].map(([resource, lines]) => ({ resource, lines })));
		}
		const updateDecorations = () => this.updateInlineResultsDiff(input, resultsModel, diffModels.synchronizedPreviewModels, baselineLines);
		session.add(resultsModel.onDidChangeContent(updateDecorations));
		for (const diffModel of diffModels.synchronizedPreviewModels) {
			session.add(diffModel.originalModel.onDidChangeContent(updateDecorations));
		}
		this.inlineResultsDiffSession.value = session;

		this.inlineResultsDiffPreviousGlyphMargin = this.searchResultEditor.getOption(EditorOption.glyphMargin);
		this.searchResultEditor.updateOptions({ glyphMargin: true });
		updateDecorations();
		this.showingInlineResultsDiff = true;
		this.inlineDiffVisibleContextKey.set(true);
		this.openResultsInlineDiffAction.checked = true;
		this.openResultsInlineDiffAction.enabled = true;
		this.updateInlineResultChangeActions();
		this.searchResultEditor.focus();
	}

	private hideResultsInlineDiff(): void {
		this.showingInlineResultsDiff = false;
		this.inlineDiffVisibleContextKey?.set(false);
		this.inlineResultsDiffDecorations?.clear();
		this.clearInlineResultsDiffViewZones();
		if (this.inlineResultsDiffPreviousGlyphMargin !== undefined) {
			this.searchResultEditor.updateOptions({ glyphMargin: this.inlineResultsDiffPreviousGlyphMargin });
			this.inlineResultsDiffPreviousGlyphMargin = undefined;
		}
		this.inlineResultChanges.clear();
		this.inlineResultsDiffSession.clear();
		if (this.openResultsInlineDiffAction) {
			this.openResultsInlineDiffAction.checked = false;
		}
		this.updateInlineResultChangeActions();
		this.updateResultChangesActions();
	}

	private updateInlineResultsDiff(input: SearchEditorInput, resultsModel: ITextModel, diffModels: readonly SearchEditorResultChangeModel[], baselineLines: ResourceMap<readonly string[]>): void {
		const { decorations, previews } = this.createInlineResultsDiff(input, resultsModel, diffModels, baselineLines);
		this.inlineResultsDiffDecorations.set(decorations);
		this.searchResultEditor.changeViewZones(accessor => {
			for (const id of this.inlineResultsDiffViewZoneIds) {
				accessor.removeZone(id);
			}
			this.inlineResultsDiffViewZoneIds = previews.map(preview => accessor.addZone(this.createInlineDiffPreviewZone(preview)));
		});
		this.updateInlineResultChangeActions();
	}

	private clearInlineResultsDiffViewZones(): void {
		if (this.inlineResultsDiffViewZoneIds.length === 0) {
			return;
		}
		this.searchResultEditor.changeViewZones(accessor => {
			for (const id of this.inlineResultsDiffViewZoneIds) {
				accessor.removeZone(id);
			}
		});
		this.inlineResultsDiffViewZoneIds = [];
	}

	private createInlineDiffPreviewZone(preview: SearchEditorInlineDiff['previews'][number]): IViewZone {
		const domNode = DOM.$('.search-editor-inline-diff-preview');
		domNode.setAttribute('aria-hidden', 'true');
		if (preview.sourceText !== undefined) {
			this.appendInlineDiffPreviewRow(domNode, localize('searchEditor.inlineDiff.currentSource', "Current source"), preview.sourceText, preview.mergedText ?? '', 'removed');
		}
		if (preview.mergedText !== undefined) {
			this.appendInlineDiffPreviewRow(domNode, localize('searchEditor.inlineDiff.mergedResult', "Merged result"), preview.mergedText, preview.sourceText ?? '', 'inserted');
		}
		return { afterLineNumber: preview.afterLineNumber, heightInLines: Number(preview.sourceText !== undefined) + Number(preview.mergedText !== undefined), domNode };
	}

	private appendInlineDiffPreviewRow(container: HTMLElement, label: string, text: string, comparisonText: string, kind: 'removed' | 'inserted'): void {
		let prefixLength = 0;
		while (prefixLength < text.length && prefixLength < comparisonText.length && text[prefixLength] === comparisonText[prefixLength]) {
			prefixLength++;
		}
		let suffixLength = 0;
		while (suffixLength < text.length - prefixLength && suffixLength < comparisonText.length - prefixLength && text[text.length - suffixLength - 1] === comparisonText[comparisonText.length - suffixLength - 1]) {
			suffixLength++;
		}

		const row = DOM.append(container, DOM.$(`.search-editor-inline-diff-preview-row.${kind}`));
		DOM.append(row, DOM.$('span.search-editor-inline-diff-preview-label', undefined, label));
		const content = DOM.append(row, DOM.$('span.search-editor-inline-diff-preview-text'));
		content.title = text;
		DOM.append(content, document.createTextNode(text.slice(0, prefixLength)));
		DOM.append(content, DOM.$(`span.search-editor-inline-diff-preview-change.${kind}`, undefined, text.slice(prefixLength, text.length - suffixLength)));
		DOM.append(content, document.createTextNode(text.slice(text.length - suffixLength)));
	}

	private createInlineResultsDiff(input: SearchEditorInput, resultsModel: ITextModel, diffModels: readonly SearchEditorResultChangeModel[], baselineLines: ResourceMap<readonly string[]>): SearchEditorInlineDiff {
		this.inlineResultChanges.clear();
		const originalModels = new ResourceMap<ITextModel>();
		for (const diffModel of diffModels) {
			originalModels.set(diffModel.resource, diffModel.originalModel);
		}

		const decorations: IModelDeltaDecoration[] = [];
		const previews: SearchEditorInlineDiff['previews'] = [];
		const resultLines = parseSearchResultLines(resultsModel.getValue(), input.getResultSources());
		const linesByResource = new ResourceMap<SearchResultLine[]>();
		for (const resultLine of resultLines) {
			const lines = linesByResource.get(resultLine.resource) ?? [];
			lines.push(resultLine);
			linesByResource.set(resultLine.resource, lines);
		}
		for (const resultLine of resultLines) {
			const originalModel = originalModels.get(resultLine.resource);
			if (!originalModel) {
				continue;
			}

			const sourceLines = originalModel.getLinesContent();
			const resourceBaselineLines = baselineLines.get(resultLine.resource) ?? sourceLines;
			if (!mergeSearchResultLines(resourceBaselineLines, sourceLines, linesByResource.get(resultLine.resource) ?? []).changed) {
				continue;
			}
			const { lines: modifiedLines, changed } = mergeSearchResultLines(resourceBaselineLines, sourceLines, [resultLine]);
			if (!changed) {
				continue;
			}
			const lineChange = linesDiffComputers.getLegacy().computeDiff(sourceLines, modifiedLines, { ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false }).changes[0];
			if (!lineChange) {
				continue;
			}
			const sourceText = sourceLines.slice(lineChange.original.startLineNumber - 1, lineChange.original.endLineNumberExclusive - 1).join(originalModel.getEOL());
			const mergedText = modifiedLines.slice(lineChange.modified.startLineNumber - 1, lineChange.modified.endLineNumberExclusive - 1).join(originalModel.getEOL());
			previews.push({
				afterLineNumber: resultLine.resultLineNumber,
				sourceText: lineChange.original.isEmpty ? undefined : sourceText,
				mergedText: lineChange.modified.isEmpty ? undefined : mergedText,
			});

			decorations.push({
				range: new Range(resultLine.resultLineNumber, 1, resultLine.resultLineNumber, 1),
				options: {
					description: 'search-editor-inline-diff-line',
					glyphMarginClassName: `${ThemeIcon.asClassName(Codicon.check)} search-editor-inline-diff-apply`,
					glyphMarginHoverMessage: new MarkdownString().appendText(localize('searchEditor.applyInlineResultChange', "Apply Search Result to Source File")),
				}
			});
			this.inlineResultChanges.set(resultLine.resultLineNumber, { resource: resultLine.resource, text: modifiedLines.join(originalModel.getEOL()) });

		}
		return { decorations, previews };
	}

	getInlineResultChange(lineNumber = this.searchResultEditor.getPosition()?.lineNumber): { resource: URI; text: string } | undefined {
		return lineNumber === undefined ? undefined : this.inlineResultChanges.get(lineNumber);
	}

	goToPreviousInlineResultChange(): void {
		this.goToInlineResultChange(false);
	}

	goToNextInlineResultChange(): void {
		this.goToInlineResultChange(true);
	}

	private goToInlineResultChange(next: boolean): void {
		const lineNumbers = [...this.inlineResultChanges.keys()].sort((first, second) => first - second);
		if (lineNumbers.length === 0) {
			return;
		}

		const currentLineNumber = this.searchResultEditor.getPosition()?.lineNumber ?? (next ? 0 : Number.MAX_SAFE_INTEGER);
		const lineNumber = next
			? lineNumbers.find(candidate => candidate > currentLineNumber) ?? lineNumbers[0]
			: lineNumbers.findLast(candidate => candidate < currentLineNumber) ?? lineNumbers[lineNumbers.length - 1];
		this.searchResultEditor.setPosition(new Position(lineNumber, 1));
		this.searchResultEditor.revealLineInCenter(lineNumber);
		this.searchResultEditor.focus();
	}

	private updateInlineResultChangeActions(): void {
		const enabled = this.showingInlineResultsDiff && this.inlineResultChanges.size > 0;
		this.previousInlineResultChangeAction.enabled = enabled;
		this.nextInlineResultChangeAction.enabled = enabled;
	}

	private async createResultChangeModels(input: SearchEditorInput, resultsModel: ITextModel): Promise<SearchEditorResultChangeModels> {
		const resultLines = parseSearchResultLines(resultsModel.getValue(), input.getResultSources());
		const linesByResource = new ResourceMap<SearchResultLine[]>();
		for (const resultLine of resultLines) {
			const lines = linesByResource.get(resultLine.resource) ?? [];
			lines.push(resultLine);
			linesByResource.set(resultLine.resource, lines);
		}
		this.searchEditorResultLogService.info(`Building Search Editor result diff (mappedFiles=${linesByResource.size}, resultLines=${resultLines.length})`);

		const sourceReferences = new DisposableStore();
		const previewModels = new DisposableStore();
		const synchronizedPreviewModels: SearchEditorResultChangeModel[] = [];
		try {
			for (const [resource, lines] of linesByResource) {
				const reference = sourceReferences.add(await this.textModelService.createModelReference(resource));
				const sourceModel = reference.object.textEditorModel;
				const sourceLines = sourceModel.getLinesContent();
				const baselineLines = input.getResultBaseline(resource) ?? sourceLines;
				const { lines: modifiedLines } = mergeSearchResultLines(baselineLines, sourceLines, lines);
				const previewUri = URI.from({ scheme: 'search-editor-inline-diff', authority: generateUuid(), path: resource.path });
				const previewModel = previewModels.add(this.modelService.createModel(modifiedLines.join(sourceModel.getEOL()), this.languageService.createById(sourceModel.getLanguageId()), previewUri));
				synchronizedPreviewModels.push({ resource, originalModel: sourceModel, modifiedModel: previewModel });
			}
			return { sourceReferences, previewModels, synchronizedPreviewModels };
		} catch (error) {
			previewModels.dispose();
			sourceReferences.dispose();
			throw error;
		}
	}

	async getAllResultChanges(): Promise<{ resource: URI; range: Range; text: string; versionId: number }[]> {
		const input = this.getInput();
		const resultsModel = this.searchResultEditor.getModel();
		if (!input || !resultsModel) {
			return [];
		}

		const diffModels = await this.createResultChangeModels(input, resultsModel);
		try {
			return diffModels.synchronizedPreviewModels
				.filter(model => model.originalModel.getValue() !== model.modifiedModel.getValue())
				.map(model => ({ resource: model.resource, range: model.originalModel.getFullModelRange(), text: model.modifiedModel.getValue(), versionId: model.originalModel.getVersionId() }));
		} finally {
			diffModels.previewModels.dispose();
			diffModels.sourceReferences.dispose();
		}
	}

	async rebaseAppliedResultChanges(resources: readonly URI[]): Promise<void> {
		const input = this.getInput();
		const resultsModel = this.searchResultEditor.getModel();
		if (!input || !resultsModel) {
			return;
		}

		const sources = this.resolveResultSources(input, resultsModel.getValue());
		const resultLines = parseSearchResultLines(resultsModel.getValue(), sources);
		const baselineLines = new ResourceMap<readonly string[]>();
		for (const entry of input.getResultBaselineEntries()) {
			baselineLines.set(entry.resource, entry.lines);
		}
		const rebasedResources: URI[] = [];
		const sourceReferences = new DisposableStore();
		try {
			const seen = new ResourceMap<boolean>();
			for (const resource of resources) {
				if (seen.has(resource)) {
					continue;
				}
				seen.set(resource, true);
				const lines = resultLines.filter(line => isEqual(line.resource, resource));
				if (lines.length === 0) {
					continue;
				}
				const reference = sourceReferences.add(await this.textModelService.createModelReference(resource));
				const sourceLines = reference.object.textEditorModel.getLinesContent();
				if (mergeSearchResultLines(baselineLines.get(resource) ?? sourceLines, sourceLines, lines).changed) {
					continue;
				}
				baselineLines.set(resource, sourceLines);
				rebasedResources.push(resource);
			}
			if (rebasedResources.length === 0) {
				return;
			}

			resultsModel.setValue(rebaseSearchResultLines(resultsModel.getValue(), sources, rebasedResources));
			input.setResultBaseline([...baselineLines].map(([resource, lines]) => ({ resource, lines })));
		} finally {
			sourceReferences.dispose();
		}
	}

	private async captureResultBaseline(input: SearchEditorInput, sources: readonly SearchResultSource[]): Promise<void> {
		const sourceReferences = new DisposableStore();
		const entries: { resource: URI; lines: readonly string[] }[] = [];
		try {
			const seen = new ResourceMap<boolean>();
			for (const source of sources) {
				if (seen.has(source.resource)) {
					continue;
				}
				seen.set(source.resource, true);
				try {
					const reference = sourceReferences.add(await this.textModelService.createModelReference(source.resource));
					entries.push({ resource: source.resource, lines: reference.object.textEditorModel.getLinesContent() });
				} catch (error) {
					this.logService.warn(`SearchEditor: Failed to capture result baseline for ${source.resource.toString()}`, error);
				}
			}
			input.setResultBaseline(entries);
		} finally {
			sourceReferences.dispose();
		}
	}

	private updateResultChangesActions(): void {
		const update = ++this.resultsDiffUpdate;
		this.resultChangesDecorations.clear();
		this.openResultsInlineDiffAction.enabled = false;
		this.applyAllResultChangesAction.enabled = false;
		void this.resultsDiffDelayer.trigger(async () => {
			const input = this.getInput();
			const resultsModel = this.searchResultEditor.getModel();
			if (!input || !resultsModel) {
				return;
			}

			try {
				const { mappedFileCount, changedFileCount, decorations, sourceSession } = await this.getUnappliedChangesCount(input, resultsModel);

				if (update === this.resultsDiffUpdate) {
					this.resultChangesSourceSession.value = sourceSession;
					this.searchEditorResultLogService.debug(`Compared Search Editor results with source files (mappedFiles=${mappedFileCount}, changedFiles=${changedFileCount})`);
					this.openResultsInlineDiffAction.enabled = changedFileCount > 0;
					this.applyAllResultChangesAction.enabled = changedFileCount > 0;
					this.resultChangesDecorations.set(decorations);
					input.setUnappliedChangesCount(changedFileCount);
					this.updateUnappliedChangesStatus(changedFileCount);
				} else {
					sourceSession.dispose();
				}
			} catch (error) {
				this.searchEditorResultLogService.error('Failed to compare Search Editor results with source files', error);
				this.logService.warn('SearchEditor: Failed to compare search results with source files', error);
			}
		});
	}

	private async getUnappliedChangesCount(input: SearchEditorInput, resultsModel: ITextModel): Promise<{ mappedFileCount: number; changedFileCount: number; decorations: IModelDeltaDecoration[]; sourceSession: DisposableStore }> {
		const resultSources = this.resolveResultSources(input, resultsModel.getValue());
		input.setResultSources(resultSources);
		const linesByResource = new ResourceMap<SearchResultLine[]>();
		for (const resultLine of parseSearchResultLines(resultsModel.getValue(), resultSources)) {
			const lines = linesByResource.get(resultLine.resource) ?? [];
			lines.push(resultLine);
			linesByResource.set(resultLine.resource, lines);
		}

		const sourceSession = new DisposableStore();
		try {
			let changedFileCount = 0;
			const decorations: IModelDeltaDecoration[] = [];
			for (const [resource, lines] of linesByResource) {
				const reference = sourceSession.add(await this.textModelService.createModelReference(resource));
				const sourceModel = reference.object.textEditorModel;
				sourceSession.add(sourceModel.onDidChangeContent(() => this.updateResultChangesActions()));
				let changedLineCount = 0;
				const sourceLines = sourceModel.getLinesContent();
				const baselineLines = input.getResultBaseline(resource) ?? sourceLines;
				if (!mergeSearchResultLines(baselineLines, sourceLines, lines).changed) {
					continue;
				}
				for (const line of lines) {
					if (mergeSearchResultLines(baselineLines, sourceLines, [line]).changed) {
						changedLineCount++;
						decorations.push({
							range: new Range(line.resultLineNumber, 1, line.resultLineNumber, 1),
							options: {
								description: 'search-editor-result-modified',
								linesDecorationsClassName: 'search-editor-result-modified',
								linesDecorationsTooltip: localize('searchEditor.resultModified', "Search result differs from the current source."),
							},
						});
					}
				}
				if (changedLineCount > 0) {
					changedFileCount++;
					const fileLineNumber = lines[0].resultFileLineNumber;
					const fileLineMaxColumn = resultsModel.getLineMaxColumn(fileLineNumber);
					decorations.push({
						range: new Range(fileLineNumber, fileLineMaxColumn, fileLineNumber, fileLineMaxColumn),
						options: {
							description: 'search-editor-file-modified',
							showIfCollapsed: true,
							after: {
								content: changedLineCount === 1
									? localize('searchEditor.fileModifiedSingle', "  1 unapplied change")
									: localize('searchEditor.fileModifiedMultiple', "  {0} unapplied changes", changedLineCount),
								inlineClassName: 'search-editor-file-modified',
							},
						},
					});
				}
			}
			return { mappedFileCount: linesByResource.size, changedFileCount, decorations, sourceSession };
		} catch (error) {
			sourceSession.dispose();
			throw error;
		}
	}

	private updateUnappliedChangesStatus(count: number): void {
		this.unappliedChangesStatus.hidden = count === 0;
		this.unappliedChangesStatus.textContent = count === 1
			? localize('searchEditor.unappliedChangeStatus', "1 file with unapplied changes")
			: localize('searchEditor.unappliedChangesStatus', "{0} files with unapplied changes", count);
	}

	updateResultsDiffAction(): void {
		this.updateResultChangesActions();
	}

	private resolveResultSources(input: SearchEditorInput, text: string): SearchResultSource[] {
		const existingSources = new Map(input.getResultSources().map(source => [source.label, source.resource]));
		const workspaceFolders = this.contextService.getWorkspace().folders;
		const resultsWorkspaceFolder = input.backingUri ? this.contextService.getWorkspaceFolder(input.backingUri) : undefined;
		const normalizePath = (path: string) => path.replace(/\\/g, '/');

		return extractSearchResultSourceLabels(text).flatMap(label => {
			const existingResource = existingSources.get(label);
			if (existingResource) {
				return [{ label, resource: existingResource }];
			}

			let resource: URI | undefined;
			const settingsPrefix = '(Settings) ';
			if (label.startsWith(settingsPrefix)) {
				resource = URI.file(label.slice(settingsPrefix.length)).with({ scheme: Schemas.vscodeUserData });
			} else if (/^[\\/]Untitled-\d*$/.test(label)) {
				resource = URI.file(label.slice(1)).with({ scheme: Schemas.untitled, path: label.slice(1) });
			} else if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(label)) {
				const remoteFolder = resultsWorkspaceFolder && resultsWorkspaceFolder.uri.scheme !== Schemas.file
					? resultsWorkspaceFolder
					: workspaceFolders.find(folder => folder.uri.scheme !== Schemas.file);
				const path = normalizePath(label);
				resource = remoteFolder
					? remoteFolder.uri.with({ path: /^[a-zA-Z]:\//.test(path) ? `/${path}` : path })
					: URI.file(label);
			} else if (label.startsWith('~/')) {
				const referenceResource = input.backingUri ?? workspaceFolders[0]?.uri;
				const home = referenceResource ? this.labelService.getUriHome(referenceResource) : undefined;
				resource = home ? joinPath(home, normalizePath(label.slice(2))) : undefined;
			} else {
				const multiRootPath = /^(.*) • (.*)$/.exec(label);
				if (multiRootPath) {
					const folder = workspaceFolders.find(folder => folder.name === multiRootPath[1]);
					resource = folder ? joinPath(folder.uri, normalizePath(multiRootPath[2])) : undefined;
				} else if (workspaceFolders.length === 1) {
					resource = joinPath(workspaceFolders[0].uri, normalizePath(label));
				} else if (resultsWorkspaceFolder) {
					resource = joinPath(resultsWorkspaceFolder.uri, normalizePath(label));
				}
			}

			return resource ? [{ label, resource }] : [];
		});
	}

	private toggleRunAgainMessage(show: boolean) {
		DOM.clearNode(this.messageBox);
		this.messageDisposables.clear();

		if (show) {
			const runAgainLink = DOM.append(this.messageBox, DOM.$('a.pointer.prominent.message', {}, localize('runSearch', "Run Search")));
			this.messageDisposables.add(DOM.addDisposableListener(runAgainLink, DOM.EventType.CLICK, async () => {
				await this.triggerSearch();
				this.searchResultEditor.focus();
			}));
		}
	}

	private _getContributions(): IEditorContributionDescription[] {
		const skipContributions = [UnusualLineTerminatorsDetector.ID];
		return EditorExtensionsRegistry.getEditorContributions().filter(c => skipContributions.indexOf(c.id) === -1);
	}

	protected override getCodeEditorWidgetOptions(): ICodeEditorWidgetOptions {
		return { contributions: this._getContributions() };
	}

	private registerEditorListeners() {
		this._register(this.searchResultEditor.onMouseUp(e => {
			if (e.event.detail === 1) {
				const behaviour = this.searchConfig.searchEditor.singleClickBehaviour;
				const position = e.target.position;
				if (position && behaviour === 'peekDefinition') {
					const line = this.searchResultEditor.getModel()?.getLineContent(position.lineNumber) ?? '';
					if (line.match(FILE_LINE_REGEX) || line.match(RESULT_LINE_REGEX)) {
						this.searchResultEditor.setSelection(Range.fromPositions(position));
						this.commandService.executeCommand('editor.action.peekDefinition');
					}
				}
			} else if (e.event.detail === 2) {
				const behaviour = this.searchConfig.searchEditor.doubleClickBehaviour;
				const position = e.target.position;
				if (position && behaviour !== 'selectWord') {
					const line = this.searchResultEditor.getModel()?.getLineContent(position.lineNumber) ?? '';
					if (line.match(RESULT_LINE_REGEX)) {
						this.searchResultEditor.setSelection(Range.fromPositions(position));
						this.commandService.executeCommand(behaviour === 'goToLocation' ? 'editor.action.goToDeclaration' : 'editor.action.openDeclarationToTheSide');
					} else if (line.match(FILE_LINE_REGEX)) {
						this.searchResultEditor.setSelection(Range.fromPositions(position));
						this.commandService.executeCommand('editor.action.peekDefinition');
					}
				}
			}
		}));
		this._register(this.searchResultEditor.onDidChangeModelContent(() => {
			if (!this.updatingModelForSearch) {
				this.getInput()?.setDirty(true);
				this.updateResultChangesActions();
			}
		}));
	}

	override getControl() {
		return this.searchResultEditor;
	}

	override focus() {
		super.focus();
		this.updateResultChangesActions();

		const viewState = this.loadEditorViewState(this.getInput());
		if (viewState && viewState.focused === 'editor') {
			this.searchResultEditor.focus();
		} else {
			this.queryEditorWidget.focus();
		}
	}

	focusSearchInput() {
		this.queryEditorWidget.searchInput?.focus();
	}

	focusFilesToIncludeInput() {
		if (!this.showingIncludesExcludes) {
			this.toggleIncludesExcludes(true);
		}
		this.inputPatternIncludes.focus();
	}

	focusFilesToExcludeInput() {
		if (!this.showingIncludesExcludes) {
			this.toggleIncludesExcludes(true);
		}
		this.inputPatternExcludes.focus();
	}

	focusNextInput() {
		if (this.queryEditorWidget.searchInputHasFocus()) {
			if (this.showingIncludesExcludes) {
				this.inputPatternIncludes.focus();
			} else {
				this.searchResultEditor.focus();
			}
		} else if (this.inputPatternIncludes.inputHasFocus()) {
			this.inputPatternExcludes.focus();
		} else if (this.inputPatternExcludes.inputHasFocus()) {
			this.searchResultEditor.focus();
		} else if (this.searchResultEditor.hasWidgetFocus()) {
			// pass
		}
	}

	focusPrevInput() {
		if (this.queryEditorWidget.searchInputHasFocus()) {
			this.searchResultEditor.focus(); // wrap
		} else if (this.inputPatternIncludes.inputHasFocus()) {
			this.queryEditorWidget.searchInput?.focus();
		} else if (this.inputPatternExcludes.inputHasFocus()) {
			this.inputPatternIncludes.focus();
		} else if (this.searchResultEditor.hasWidgetFocus()) {
			// unreachable.
		}
	}

	setQuery(query: string) {
		this.queryEditorWidget.searchInput?.setValue(query);
	}

	selectQuery() {
		this.queryEditorWidget.searchInput?.select();
	}

	toggleWholeWords() {
		this.queryEditorWidget.searchInput?.setWholeWords(!this.queryEditorWidget.searchInput.getWholeWords());
		this.triggerSearch({ resetCursor: false });
	}

	toggleRegex() {
		this.queryEditorWidget.searchInput?.setRegex(!this.queryEditorWidget.searchInput.getRegex());
		this.triggerSearch({ resetCursor: false });
	}

	toggleCaseSensitive() {
		this.queryEditorWidget.searchInput?.setCaseSensitive(!this.queryEditorWidget.searchInput.getCaseSensitive());
		this.triggerSearch({ resetCursor: false });
	}

	toggleContextLines() {
		this.queryEditorWidget.toggleContextLines();
	}

	modifyContextLines(increase: boolean) {
		this.queryEditorWidget.modifyContextLines(increase);
	}

	toggleQueryDetails(shouldShow?: boolean) {
		this.toggleIncludesExcludes(shouldShow);
	}

	deleteResultBlock() {
		const linesToDelete = new Set<number>();

		const selections = this.searchResultEditor.getSelections();
		const model = this.searchResultEditor.getModel();
		if (!(selections && model)) { return; }

		const maxLine = model.getLineCount();
		const minLine = 1;

		const deleteUp = (start: number) => {
			for (let cursor = start; cursor >= minLine; cursor--) {
				const line = model.getLineContent(cursor);
				linesToDelete.add(cursor);
				if (line[0] !== undefined && line[0] !== ' ') {
					break;
				}
			}
		};

		const deleteDown = (start: number): number | undefined => {
			linesToDelete.add(start);
			for (let cursor = start + 1; cursor <= maxLine; cursor++) {
				const line = model.getLineContent(cursor);
				if (line[0] !== undefined && line[0] !== ' ') {
					return cursor;
				}
				linesToDelete.add(cursor);
			}
			return;
		};

		const endingCursorLines: Array<number | undefined> = [];
		for (const selection of selections) {
			const lineNumber = selection.startLineNumber;
			endingCursorLines.push(deleteDown(lineNumber));
			deleteUp(lineNumber);
			for (let inner = selection.startLineNumber; inner <= selection.endLineNumber; inner++) {
				linesToDelete.add(inner);
			}
		}

		if (endingCursorLines.length === 0) { endingCursorLines.push(1); }

		const isDefined = <T>(x: T | undefined): x is T => x !== undefined;

		model.pushEditOperations(this.searchResultEditor.getSelections(),
			[...linesToDelete].map(line => ({ range: new Range(line, 1, line + 1, 1), text: '' })),
			() => endingCursorLines.filter(isDefined).map(line => new Selection(line, 1, line, 1)));
	}

	insertSourceLine(above: boolean): void {
		const model = this.searchResultEditor.getModel();
		const input = this.getInput();
		const position = this.searchResultEditor.getPosition();
		if (!model || !input || !position) {
			return;
		}
		const sources = this.resolveResultSources(input, model.getValue());
		const resultLine = parseSearchResultLines(model.getValue(), sources).find(line => line.resultLineNumber === position.lineNumber);
		if (!resultLine) {
			return;
		}
		const anchorLineNumber = getSearchResultInsertAnchorLineNumber(resultLine, above);
		const indentation = model.getLineContent(position.lineNumber).match(/^\s*/)?.[0] ?? '  ';
		const text = `${indentation}${anchorLineNumber}+: `;
		const insertLineNumber = above ? position.lineNumber : position.lineNumber + 1;
		const range = above
			? new Range(position.lineNumber, 1, position.lineNumber, 1)
			: new Range(position.lineNumber, model.getLineMaxColumn(position.lineNumber), position.lineNumber, model.getLineMaxColumn(position.lineNumber));
		const editText = above ? `${text}${model.getEOL()}` : `${model.getEOL()}${text}`;
		model.pushEditOperations(this.searchResultEditor.getSelections(), [{ range, text: editText }], () => [new Selection(insertLineNumber, text.length + 1, insertLineNumber, text.length + 1)]);
		this.searchResultEditor.revealLineInCenterIfOutsideViewport(insertLineNumber);
		this.searchResultEditor.focus();
	}

	enterSourceLine(): void {
		const model = this.searchResultEditor.getModel();
		const input = this.getInput();
		const selection = this.searchResultEditor.getSelection();
		if (!model || !input || !selection) {
			return;
		}
		const sources = this.resolveResultSources(input, model.getValue());
		const resultLine = parseSearchResultLines(model.getValue(), sources).find(line => line.resultLineNumber === selection.positionLineNumber);
		if (!selection.isEmpty() || !resultLine || resultLine.kind === 'delete') {
			this.insertSourceLine(false);
			return;
		}

		const splitOffset = Math.max(0, selection.positionColumn - resultLine.resultStartColumn);
		const currentText = resultLine.text.slice(0, splitOffset);
		const insertedText = resultLine.text.slice(splitOffset);
		const anchorLineNumber = getSearchResultInsertAnchorLineNumber(resultLine, false);
		const indentation = model.getLineContent(resultLine.resultLineNumber).match(/^\s*/)?.[0] ?? '  ';
		const insertedPrefix = `${indentation}${anchorLineNumber}+: `;
		model.pushEditOperations(
			this.searchResultEditor.getSelections(),
			[{
				range: new Range(resultLine.resultLineNumber, resultLine.resultStartColumn, resultLine.resultLineNumber, model.getLineMaxColumn(resultLine.resultLineNumber)),
				text: `${currentText}${model.getEOL()}${insertedPrefix}${insertedText}`,
			}],
			() => [new Selection(resultLine.resultLineNumber + 1, insertedPrefix.length + 1, resultLine.resultLineNumber + 1, insertedPrefix.length + 1)],
		);
		this.searchResultEditor.revealLineInCenterIfOutsideViewport(resultLine.resultLineNumber + 1);
		this.searchResultEditor.focus();
	}

	deleteSourceLine(): void {
		const model = this.searchResultEditor.getModel();
		const input = this.getInput();
		const position = this.searchResultEditor.getPosition();
		if (!model || !input || !position) {
			return;
		}
		const sources = this.resolveResultSources(input, model.getValue());
		const resultLine = parseSearchResultLines(model.getValue(), sources).find(line => line.resultLineNumber === position.lineNumber);
		if (!resultLine || resultLine.kind !== 'replace') {
			return;
		}
		const operationColumn = resultLine.resultStartColumn - 2;
		model.pushEditOperations(
			this.searchResultEditor.getSelections(),
			[{ range: new Range(position.lineNumber, operationColumn, position.lineNumber, operationColumn), text: '-' }],
			() => [new Selection(position.lineNumber, position.column + 1, position.lineNumber, position.column + 1)],
		);
		this.searchResultEditor.focus();
	}

	backspaceSourceLine(): void {
		const model = this.searchResultEditor.getModel();
		const input = this.getInput();
		const selection = this.searchResultEditor.getSelection();
		if (!model || !input || !selection) {
			return;
		}
		const sources = this.resolveResultSources(input, model.getValue());
		const resultLine = parseSearchResultLines(model.getValue(), sources).find(line => line.resultLineNumber === selection.startLineNumber);
		const selectsWholeLine = resultLine?.kind === 'replace'
			&& selection.startColumn <= model.getLineFirstNonWhitespaceColumn(selection.startLineNumber)
			&& (selection.endLineNumber === selection.startLineNumber
				? selection.endColumn === model.getLineMaxColumn(selection.startLineNumber)
				: selection.endLineNumber === selection.startLineNumber + 1 && selection.endColumn === 1);
		const deletesEmptyLine = resultLine?.kind === 'replace'
			&& resultLine.text.length === 0
			&& selection.isEmpty()
			&& selection.positionColumn <= resultLine.resultStartColumn;
		if (!resultLine || (!selectsWholeLine && !deletesEmptyLine)) {
			void this.commandService.executeCommand('deleteLeft');
			return;
		}

		const operationColumn = resultLine.resultStartColumn - 2;
		model.pushEditOperations(
			this.searchResultEditor.getSelections(),
			[{ range: new Range(resultLine.resultLineNumber, operationColumn, resultLine.resultLineNumber, operationColumn), text: '-' }],
			() => [new Selection(resultLine.resultLineNumber, resultLine.resultStartColumn + 1, resultLine.resultLineNumber, resultLine.resultStartColumn + 1)],
		);
		this.searchResultEditor.focus();
	}

	cleanState() {
		this.getInput()?.setDirty(false);
	}

	private get searchConfig(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	private iterateThroughMatches(reverse: boolean) {
		const model = this.searchResultEditor.getModel();
		if (!model) { return; }

		const lastLine = model.getLineCount() ?? 1;
		const lastColumn = model.getLineLength(lastLine);

		const fallbackStart = reverse ? new Position(lastLine, lastColumn) : new Position(1, 1);

		const currentPosition = this.searchResultEditor.getSelection()?.getStartPosition() ?? fallbackStart;

		const matchRanges = this.getInput()?.getMatchRanges();
		if (!matchRanges) { return; }

		const matchRange = (reverse ? findPrevRange : findNextRange)(matchRanges, currentPosition);
		if (!matchRange) { return; }

		this.searchResultEditor.setSelection(matchRange);
		this.searchResultEditor.revealLineInCenterIfOutsideViewport(matchRange.startLineNumber);
		this.searchResultEditor.focus();

		const matchLineText = model.getLineContent(matchRange.startLineNumber);
		const matchText = model.getValueInRange(matchRange);
		let file = '';
		for (let line = matchRange.startLineNumber; line >= 1; line--) {
			const lineText = model.getValueInRange(new Range(line, 1, line, 2));
			if (lineText !== ' ') { file = model.getLineContent(line); break; }
		}
		alert(localize('searchResultItem', "Matched {0} at {1} in file {2}", matchText, matchLineText, file.slice(0, file.length - 1)));
	}

	focusNextResult() {
		this.iterateThroughMatches(false);
	}

	focusPreviousResult() {
		this.iterateThroughMatches(true);
	}

	focusAllResults() {
		this.searchResultEditor
			.setSelections((this.getInput()?.getMatchRanges() ?? []).map(
				range => new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)));
		this.searchResultEditor.focus();
	}

	async triggerSearch(_options?: { resetCursor?: boolean; delay?: number; focusResults?: boolean }) {
		const focusResults = this.searchConfig.searchEditor.focusResultsOnSearch;

		// If _options don't define focusResult field, then use the setting
		if (_options === undefined) {
			_options = { focusResults: focusResults };
		} else if (_options.focusResults === undefined) {
			_options.focusResults = focusResults;
		}

		const options = { resetCursor: true, delay: 0, ..._options };

		if (!(this.queryEditorWidget.searchInput?.inputBox.isInputValid())) {
			return;
		}

		if (!this.pauseSearching) {
			await this.runSearchDelayer.trigger(async () => {
				if (!await this.confirmSearchWithUnappliedChanges()) {
					return;
				}
				this.hideResultsInlineDiff();
				this.toggleRunAgainMessage(false);
				await this.doRunSearch();
				if (options.resetCursor) {
					this.searchResultEditor.setPosition(new Position(1, 1));
					this.searchResultEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
				}
				if (options.focusResults) {
					this.searchResultEditor.focus();
				}
			}, options.delay);
		}
	}

	private async confirmSearchWithUnappliedChanges(): Promise<boolean> {
		const input = this.getInput();
		const resultsModel = this.searchResultEditor.getModel();
		if (!input?.isDirty() || !resultsModel) {
			return true;
		}

		const { changedFileCount } = await this.getUnappliedChangesCount(input, resultsModel);
		if (changedFileCount === 0) {
			return true;
		}

		if (this.confirmedUnappliedChanges?.input === input && this.confirmedUnappliedChanges.versionId === resultsModel.getVersionId()) {
			return true;
		}

		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('searchEditor.confirmSearchWithUnappliedChanges', "Start a new search?"),
			detail: localize('searchEditor.confirmSearchWithUnappliedChangesDetail', "This Search Editor has unapplied changes that will be lost unless you save it before starting a new search."),
			primaryButton: localize('searchEditor.startNewSearch', "Start New Search"),
		});
		if (confirmed) {
			this.confirmedUnappliedChanges = { input, versionId: resultsModel.getVersionId() };
		}
		return confirmed;
	}

	private readConfigFromWidget(): SearchConfiguration {
		return {
			isCaseSensitive: this.queryEditorWidget.searchInput?.getCaseSensitive() ?? false,
			contextLines: this.queryEditorWidget.getContextLines(),
			filesToExclude: this.inputPatternExcludes.getValue(),
			filesToInclude: this.inputPatternIncludes.getValue(),
			query: this.queryEditorWidget.searchInput?.getValue() ?? '',
			isRegexp: this.queryEditorWidget.searchInput?.getRegex() ?? false,
			matchWholeWord: this.queryEditorWidget.searchInput?.getWholeWords() ?? false,
			useExcludeSettingsAndIgnoreFiles: this.inputPatternExcludes.useExcludesAndIgnoreFiles(),
			onlyOpenEditors: this.inputPatternIncludes.onlySearchInOpenEditors(),
			showIncludesExcludes: this.showingIncludesExcludes,
			notebookSearchConfig: {
				includeMarkupInput: this.queryEditorWidget.getNotebookFilters().markupInput,
				includeMarkupPreview: this.queryEditorWidget.getNotebookFilters().markupPreview,
				includeCodeInput: this.queryEditorWidget.getNotebookFilters().codeInput,
				includeOutput: this.queryEditorWidget.getNotebookFilters().codeOutput,
			}
		};
	}

	private async doRunSearch() {
		this.searchModel.cancelSearch(true);

		const startInput = this.getInput();
		if (!startInput) { return; }

		this.searchHistoryDelayer.trigger(() => {
			this.queryEditorWidget.searchInput?.onSearchSubmit();
			this.inputPatternExcludes.onSearchSubmit();
			this.inputPatternIncludes.onSearchSubmit();
		});

		const config = this.readConfigFromWidget();

		if (!config.query) { return; }

		const content: IPatternInfo = {
			pattern: config.query,
			isRegExp: config.isRegexp,
			isCaseSensitive: config.isCaseSensitive,
			isWordMatch: config.matchWholeWord,
		};

		const options: ITextQueryBuilderOptions = {
			_reason: 'searchEditor',
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			maxResults: this.searchConfig.maxResults ?? undefined,
			disregardIgnoreFiles: !config.useExcludeSettingsAndIgnoreFiles || undefined,
			disregardExcludeSettings: !config.useExcludeSettingsAndIgnoreFiles || undefined,
			excludePattern: [{ pattern: config.filesToExclude }],
			includePattern: config.filesToInclude,
			onlyOpenEditors: config.onlyOpenEditors,
			previewOptions: {
				matchLines: 1,
				charsPerLine: 1000
			},
			surroundingContext: config.contextLines,
			isSmartCase: this.searchConfig.smartCase,
			expandPatterns: true,
			notebookSearchConfig: {
				includeMarkupInput: config.notebookSearchConfig.includeMarkupInput,
				includeMarkupPreview: config.notebookSearchConfig.includeMarkupPreview,
				includeCodeInput: config.notebookSearchConfig.includeCodeInput,
				includeOutput: config.notebookSearchConfig.includeOutput,
			}
		};

		const folderResources = this.contextService.getWorkspace().folders;
		let query: ITextQuery;
		try {
			const queryBuilder = this.instantiationService.createInstance(QueryBuilder);
			query = queryBuilder.text(content, folderResources.map(folder => folder.uri), options);
		}
		catch (err) {
			return;
		}

		this.searchOperation.start(500);
		this.ongoingOperations++;

		const { configurationModel } = await startInput.resolveModels();
		configurationModel.updateConfig(config);
		const result = this.searchModel.search(query);
		startInput.ongoingSearchOperation = result.asyncResults.finally(() => {
			this.ongoingOperations--;
			if (this.ongoingOperations === 0) {
				this.searchOperation.stop();
			}
		});

		const searchOperation = await startInput.ongoingSearchOperation;
		await this.onSearchComplete(searchOperation, config, startInput);
	}

	private async onSearchComplete(searchOperation: ISearchComplete, startConfig: SearchConfiguration, startInput: SearchEditorInput) {
		const input = this.getInput();
		if (!input ||
			input !== startInput ||
			JSON.stringify(startConfig) !== JSON.stringify(this.readConfigFromWidget())) {
			return;
		}

		input.ongoingSearchOperation = undefined;

		const sortOrder = this.searchConfig.sortOrder;
		if (sortOrder === SearchSortOrder.Modified) {
			await this.retrieveFileStats(this.searchModel.searchResult);
		}

		const controller = ReferencesController.get(this.searchResultEditor);
		controller?.closeWidget(false);
		const labelFormatter = (uri: URI): string => this.labelService.getUriLabel(uri, { relative: true });
		const results = await serializeSearchResultForEditor(this.searchModel.searchResult, startConfig.filesToInclude, startConfig.filesToExclude, startConfig.contextLines, labelFormatter, sortOrder, searchOperation?.limitHit);
		const { resultsModel } = await input.resolveModels();
		input.setResultSources(results.sources);
		await this.captureResultBaseline(input, results.sources);
		this.updatingModelForSearch = true;
		this.modelService.updateModel(resultsModel, results.text);
		this.updatingModelForSearch = false;
		this.updateResultChangesActions();

		if (searchOperation && searchOperation.messages) {
			for (const message of searchOperation.messages) {
				this.addMessage(message);
			}
		}
		this.reLayout();

		input.setDirty(!input.hasCapability(EditorInputCapabilities.Untitled));
		input.setMatchRanges(results.matchRanges);
	}

	private addMessage(message: TextSearchCompleteMessage) {
		let messageBox: HTMLElement;
		if (this.messageBox.firstChild) {
			messageBox = this.messageBox.firstChild as HTMLElement;
		} else {
			messageBox = DOM.append(this.messageBox, DOM.$('.message'));
		}

		DOM.append(messageBox, renderSearchMessage(message, this.instantiationService, this.notificationService, this.openerService, this.commandService, this.messageDisposables, () => this.triggerSearch()));
	}

	private async retrieveFileStats(searchResult: ISearchResult): Promise<void> {
		const files = searchResult.matches().filter(f => !f.fileStat).map(f => f.resolveFileStat(this.fileService));
		await Promise.all(files);
	}

	override layout(dimension: DOM.Dimension) {
		this.dimension = dimension;
		this.reLayout();
	}

	getSelected() {
		const selection = this.searchResultEditor.getSelection();
		if (selection) {
			return this.searchResultEditor.getModel()?.getValueInRange(selection) ?? '';
		}
		return '';
	}

	private reLayout() {
		if (this.dimension) {
			const configuredOffset = Number.parseFloat(DOM.getWindow(this.queryEditorContainer).getComputedStyle(this.queryEditorContainer).getPropertyValue('--search-editor-query-layout-offset'));
			const queryEditorWidth = this.dimension.width - (Number.isFinite(configuredOffset) ? configuredOffset : DEFAULT_QUERY_EDITOR_LAYOUT_OFFSET);
			this.queryEditorWidget.setWidth(queryEditorWidth);
			const resultsDimension = { height: this.dimension.height - DOM.getTotalHeight(this.queryEditorContainer), width: this.dimension.width };
			this.searchResultEditor.layout(resultsDimension);
			this.inputPatternExcludes.setWidth(queryEditorWidth);
			this.inputPatternIncludes.setWidth(queryEditorWidth);
		}
	}

	private getInput(): SearchEditorInput | undefined {
		return this.input as SearchEditorInput;
	}

	private priorConfig: Partial<Readonly<SearchConfiguration>> | undefined;
	setSearchConfig(config: Partial<Readonly<SearchConfiguration>>) {
		this.priorConfig = config;
		if (config.query !== undefined) { this.queryEditorWidget.setValue(config.query); }
		if (config.isCaseSensitive !== undefined) { this.queryEditorWidget.searchInput?.setCaseSensitive(config.isCaseSensitive); }
		if (config.isRegexp !== undefined) { this.queryEditorWidget.searchInput?.setRegex(config.isRegexp); }
		if (config.matchWholeWord !== undefined) { this.queryEditorWidget.searchInput?.setWholeWords(config.matchWholeWord); }
		if (config.contextLines !== undefined) { this.queryEditorWidget.setContextLines(config.contextLines); }
		if (config.filesToExclude !== undefined) { this.inputPatternExcludes.setValue(config.filesToExclude); }
		if (config.filesToInclude !== undefined) { this.inputPatternIncludes.setValue(config.filesToInclude); }
		if (config.onlyOpenEditors !== undefined) { this.inputPatternIncludes.setOnlySearchInOpenEditors(config.onlyOpenEditors); }
		if (config.useExcludeSettingsAndIgnoreFiles !== undefined) { this.inputPatternExcludes.setUseExcludesAndIgnoreFiles(config.useExcludeSettingsAndIgnoreFiles); }
		if (config.showIncludesExcludes !== undefined) { this.toggleIncludesExcludes(config.showIncludesExcludes); }
	}

	override async setInput(newInput: SearchEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.hideResultsInlineDiff();
		await super.setInput(newInput, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}

		const { configurationModel, resultsModel } = await newInput.resolveModels();
		if (token.isCancellationRequested) { return; }

		this.searchResultEditor.setModel(resultsModel);
		if (!newInput.hasResultBaseline()) {
			const resultSources = this.resolveResultSources(newInput, resultsModel.getValue());
			newInput.setResultSources(resultSources);
			await this.captureResultBaseline(newInput, resultSources);
			if (token.isCancellationRequested) { return; }
		}
		this.updateUnappliedChangesStatus(newInput.getUnappliedChangesCount());
		this.updateResultChangesActions();
		this.pauseSearching = true;

		this.toggleRunAgainMessage(!newInput.ongoingSearchOperation && resultsModel.getLineCount() === 1 && resultsModel.getValueLength() === 0 && configurationModel.config.query !== '');

		this.setSearchConfig(configurationModel.config);

		this._register(configurationModel.onConfigDidUpdate(newConfig => {
			if (newConfig !== this.priorConfig) {
				this.pauseSearching = true;
				this.setSearchConfig(newConfig);
				this.pauseSearching = false;
			}
		}));

		this.restoreViewState(context);

		if (!options?.preserveFocus) {
			this.focus();
		}

		this.pauseSearching = false;

		if (newInput.ongoingSearchOperation) {
			const existingConfig = this.readConfigFromWidget();
			newInput.ongoingSearchOperation.then(complete => {
				this.onSearchComplete(complete, existingConfig, newInput);
			});
		}
	}

	private toggleIncludesExcludes(_shouldShow?: boolean): void {
		const cls = 'expanded';
		const shouldShow = _shouldShow ?? !this.includesExcludesContainer.classList.contains(cls);

		if (shouldShow) {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'true');
			this.includesExcludesContainer.classList.add(cls);
		} else {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'false');
			this.includesExcludesContainer.classList.remove(cls);
		}

		this.showingIncludesExcludes = this.includesExcludesContainer.classList.contains(cls);

		this.reLayout();
	}

	protected override toEditorViewStateResource(input: EditorInput): URI | undefined {
		if (input.typeId === SearchEditorInputTypeId) {
			return (input as SearchEditorInput).modelUri;
		}

		return undefined;
	}

	protected override computeEditorViewState(resource: URI): SearchEditorViewState | undefined {
		const control = this.getControl();
		const editorViewState = control.saveViewState();
		if (!editorViewState) { return undefined; }
		if (resource.toString() !== this.getInput()?.modelUri.toString()) { return undefined; }

		return { ...editorViewState, focused: this.searchResultEditor.hasWidgetFocus() ? 'editor' : 'input' };
	}

	protected tracksEditorViewState(input: EditorInput): boolean {
		return input.typeId === SearchEditorInputTypeId;
	}

	private restoreViewState(context: IEditorOpenContext) {
		const viewState = this.loadEditorViewState(this.getInput(), context);
		if (viewState) { this.searchResultEditor.restoreViewState(viewState); }
	}

	getAriaLabel() {
		return this.getInput()?.getName() ?? localize('searchEditor', "Search");
	}
}

const searchEditorTextInputBorder = registerColor('searchEditor.textInputBorder', inputBorder, localize('textInputBoxBorder', "Search editor text input box border."));

function findNextRange(matchRanges: Range[], currentPosition: Position) {
	for (const matchRange of matchRanges) {
		if (Position.isBefore(currentPosition, matchRange.getStartPosition())) {
			return matchRange;
		}
	}
	return matchRanges[0];
}

function findPrevRange(matchRanges: Range[], currentPosition: Position) {
	for (let i = matchRanges.length - 1; i >= 0; i--) {
		const matchRange = matchRanges[i];
		if (Position.isBefore(matchRange.getStartPosition(), currentPosition)) {
			{
				return matchRange;
			}
		}
	}
	return matchRanges[matchRanges.length - 1];
}
