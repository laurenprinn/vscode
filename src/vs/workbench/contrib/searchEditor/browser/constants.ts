/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const InSearchEditor = new RawContextKey<boolean>('inSearchEditor', false);
export const SearchEditorInlineDiffVisible = new RawContextKey<boolean>('searchEditorInlineDiffVisible', false);

export const SearchEditorScheme = 'search-editor';

export const SearchEditorWorkingCopyTypeId = 'search/editor';

export const SearchEditorFindMatchClass = 'searchEditorFindMatch';

export const SearchEditorID = 'workbench.editor.searchEditor';

export const OpenNewEditorCommandId = 'search.action.openNewEditor';
export const OpenEditorCommandId = 'search.action.openEditor';
export const OpenSearchEditorResultsInlineDiffCommandId = 'searchEditor.openResultsInlineDiff';
export const PreviousSearchEditorInlineResultChangeCommandId = 'searchEditor.previousInlineResultChange';
export const NextSearchEditorInlineResultChangeCommandId = 'searchEditor.nextInlineResultChange';
export const ApplyAllSearchEditorResultChangesCommandId = 'searchEditor.applyAllResultChanges';
export const ApplySearchEditorInlineResultChangeCommandId = 'searchEditor.applyInlineResultChange';
export const InsertSearchEditorSourceLineAboveCommandId = 'searchEditor.insertSourceLineAbove';
export const InsertSearchEditorSourceLineBelowCommandId = 'searchEditor.insertSourceLineBelow';
export const EnterSearchEditorSourceLineCommandId = 'searchEditor.enterSourceLine';
export const DeleteSearchEditorSourceLineCommandId = 'searchEditor.deleteSourceLine';
export const BackspaceSearchEditorSourceLineCommandId = 'searchEditor.backspaceSourceLine';
export const ToggleSearchEditorContextLinesCommandId = 'toggleSearchEditorContextLines';

export const SearchEditorInputTypeId = 'workbench.editorinputs.searchEditorInput';
export type SearchConfiguration = {
	query: string;
	filesToInclude: string;
	filesToExclude: string;
	contextLines: number;
	matchWholeWord: boolean;
	isCaseSensitive: boolean;
	isRegexp: boolean;
	useExcludeSettingsAndIgnoreFiles: boolean;
	showIncludesExcludes: boolean;
	onlyOpenEditors: boolean;
	notebookSearchConfig: {
		includeMarkupInput: boolean;
		includeMarkupPreview: boolean;
		includeCodeInput: boolean;
		includeOutput: boolean;
	};
};
