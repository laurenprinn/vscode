/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { ICursorStateComputer, IIdentifiedSingleEditOperation, ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IModelContentChangedEvent } from '../../../../../editor/common/textModelEvents.js';
import { SearchEditorDiffContentProvider, SearchEditorDiffModelSynchronizer, SearchEditorDiffScheme } from '../../browser/searchEditorDiffModel.js';

suite('SearchEditorDiffModel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createTestTextModel(value: string): ITextModel {
		const lines = value.split('\n');
		const onDidChangeContent = disposables.add(new Emitter<IModelContentChangedEvent>());
		return new class extends mock<ITextModel>() {
			override readonly onDidChangeContent = onDidChangeContent.event;
			override getValue = () => lines.join('\n');
			override getLineCount = () => lines.length;
			override getLineContent = (lineNumber: number) => lines[lineNumber - 1];
			override getLineMaxColumn = (lineNumber: number) => lines[lineNumber - 1].length + 1;
			override pushEditOperations(_beforeCursorState: Selection[] | null, editOperations: IIdentifiedSingleEditOperation[], _cursorStateComputer: ICursorStateComputer): Selection[] | null {
				for (const edit of editOperations) {
					const lineIndex = edit.range.startLineNumber - 1;
					const line = lines[lineIndex];
					lines[lineIndex] = line.slice(0, edit.range.startColumn - 1) + (edit.text ?? '') + line.slice(edit.range.endColumn - 1);
				}
				onDidChangeContent.fire({ changes: [], eol: '\n', versionId: 1, isUndoing: false, isRedoing: false, isFlush: false, isEolChange: false, detailedReasons: [], detailedReasonsChangeLengths: [] });
				return null;
			}
		};
	}

	test('resolves an existing preview model', async () => {
		const resource = URI.from({ scheme: SearchEditorDiffScheme, path: '/preview/file.txt' });
		const previewModel = { uri: resource } as ITextModel;
		const modelService = {
			getModel: (candidate: URI) => candidate.toString() === resource.toString() ? previewModel : null,
		} as IModelService;
		let registeredScheme: string | undefined;
		let registeredProvider: ITextModelContentProvider | undefined;
		const textModelService: ITextModelService = {
			_serviceBrand: undefined,
			createModelReference: () => { throw new Error('Unexpected call'); },
			registerTextModelContentProvider: (scheme: string, provider: ITextModelContentProvider) => {
				registeredScheme = scheme;
				registeredProvider = provider;
				return Disposable.None;
			},
			canHandleResource: () => false,
		};
		disposables.add(new SearchEditorDiffContentProvider(modelService, textModelService));

		const resolvedModel = await registeredProvider?.provideTextContent(resource);

		assert.deepStrictEqual({
			scheme: registeredScheme,
			model: resolvedModel,
		}, {
			scheme: SearchEditorDiffScheme,
			model: previewModel,
		});
	});

	test('synchronizes edits between search results and diff previews', () => {
		const source = URI.file('/file.txt');
		const resultsModel = createTestTextModel('/file.txt:\n  1: first\n  2: second');
		const previewModel = createTestTextModel('first\nsecond');
		disposables.add(new SearchEditorDiffModelSynchronizer(resultsModel, () => [{ label: '/file.txt', resource: source }], [{ resource: source, model: previewModel }]));

		previewModel.pushEditOperations(null, [{ range: new Range(1, 1, 1, 6), text: 'from diff' }], () => null);
		resultsModel.pushEditOperations(null, [{ range: new Range(3, 6, 3, 12), text: 'from search' }], () => null);

		assert.deepStrictEqual({
			results: resultsModel.getValue(),
			preview: previewModel.getValue(),
		}, {
			results: '/file.txt:\n  1: from diff\n  2: from search',
			preview: 'from diff\nfrom search',
		});
	});
});
