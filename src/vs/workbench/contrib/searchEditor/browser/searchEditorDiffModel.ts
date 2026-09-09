/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ValueWithChangeEvent } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { MultiDiffEditorItem } from '../../multiDiffEditor/browser/multiDiffSourceResolverService.js';
import { parseSearchResultLines, resolveSearchResultLineText, SearchResultSource } from './searchEditorResultLines.js';

export const SearchEditorDiffScheme = 'search-editor-diff';

export type SearchEditorDiffModel = { resource: URI; originalModel: ITextModel; modifiedModel: ITextModel; item: MultiDiffEditorItem };

export class SearchEditorDiffModelSynchronizer extends Disposable {

	private isUpdating = false;
	private readonly diffModels = new ResourceMap<SearchEditorDiffModel>();
	private readonly diffModelDisposables = this._register(new DisposableStore());
	readonly resources = new ValueWithChangeEvent<readonly MultiDiffEditorItem[]>([]);

	constructor(
		private readonly resultsModel: ITextModel,
		private readonly getResultSources: () => readonly SearchResultSource[],
		previewModels: readonly SearchEditorDiffModel[],
	) {
		super();
		this.setDiffModels(previewModels);
		this._register(this.resultsModel.onDidChangeContent(() => this.updatePreviewModels()));
	}

	setDiffModels(previewModels: readonly SearchEditorDiffModel[]): void {
		this.diffModelDisposables.clear();
		this.diffModels.clear();
		for (const diffModel of previewModels) {
			this.diffModels.set(diffModel.resource, diffModel);
			this.diffModelDisposables.add(diffModel.originalModel.onDidChangeContent(() => this.updateResources()));
			this.diffModelDisposables.add(diffModel.modifiedModel.onDidChangeContent(() => this.updateResultsModel(diffModel.modifiedModel)));
		}
		this.updateResources();
	}

	private updatePreviewModels(): void {
		this.runSynchronizedUpdate(() => {
			const editsByModel = new Map<ITextModel, { range: Range; text: string }[]>();
			for (const resultLine of parseSearchResultLines(this.resultsModel.getValue(), this.getResultSources())) {
				const previewModel = this.diffModels.get(resultLine.resource)?.modifiedModel;
				if (!previewModel || resultLine.sourceLineNumber > previewModel.getLineCount()) {
					continue;
				}
				const previewText = previewModel.getLineContent(resultLine.sourceLineNumber);
				const resultText = resolveSearchResultLineText(previewText, resultLine.text);
				if (previewText === resultText) {
					continue;
				}
				const edits = editsByModel.get(previewModel) ?? [];
				edits.push({
					range: new Range(resultLine.sourceLineNumber, 1, resultLine.sourceLineNumber, previewModel.getLineMaxColumn(resultLine.sourceLineNumber)),
					text: resultText,
				});
				editsByModel.set(previewModel, edits);
			}
			for (const [previewModel, edits] of editsByModel) {
				previewModel.pushEditOperations(null, edits, () => null);
			}
			this.updateResources();
		});
	}

	private updateResultsModel(previewModel: ITextModel): void {
		this.runSynchronizedUpdate(() => {
			const edits: { range: Range; text: string }[] = [];
			for (const resultLine of parseSearchResultLines(this.resultsModel.getValue(), this.getResultSources())) {
				const diffModel = this.diffModels.get(resultLine.resource);
				if (diffModel?.modifiedModel !== previewModel || resultLine.sourceLineNumber > previewModel.getLineCount() || resultLine.sourceLineNumber > diffModel.originalModel.getLineCount()) {
					continue;
				}
				const text = previewModel.getLineContent(resultLine.sourceLineNumber);
				const originalText = diffModel.originalModel.getLineContent(resultLine.sourceLineNumber);
				if (text !== resolveSearchResultLineText(originalText, resultLine.text)) {
					edits.push({
						range: new Range(resultLine.resultLineNumber, resultLine.resultStartColumn, resultLine.resultLineNumber, this.resultsModel.getLineMaxColumn(resultLine.resultLineNumber)),
						text,
					});
				}
			}
			if (edits.length > 0) {
				this.resultsModel.pushEditOperations(null, edits, () => null);
			}
			this.updateResources();
		});
	}

	private updateResources(): void {
		this.resources.value = [...this.diffModels.values()]
			.filter(diffModel => diffModel.originalModel.getValue() !== diffModel.modifiedModel.getValue())
			.map(diffModel => diffModel.item);
	}

	private runSynchronizedUpdate(update: () => void): void {
		if (this.isUpdating) {
			return;
		}
		this.isUpdating = true;
		try {
			update();
		} finally {
			this.isUpdating = false;
		}
	}
}

export class SearchEditorDiffContentProvider extends Disposable implements ITextModelContentProvider, IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.searchEditorDiffContentProvider';

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ITextModelService textModelService: ITextModelService,
	) {
		super();
		this._register(textModelService.registerTextModelContentProvider(SearchEditorDiffScheme, this));
	}

	provideTextContent(resource: URI): Promise<ITextModel> | null {
		const model = this.modelService.getModel(resource);
		return model ? Promise.resolve(model) : null;
	}
}
