/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { parseSearchResultLines, SearchResultSource } from './searchEditorResultLines.js';

export const SearchEditorDiffScheme = 'search-editor-diff';

export type SearchEditorDiffModel = { resource: URI; model: ITextModel };

export class SearchEditorDiffModelSynchronizer extends Disposable {

	private isUpdating = false;
	private readonly previewModels = new ResourceMap<ITextModel>();

	constructor(
		private readonly resultsModel: ITextModel,
		private readonly getResultSources: () => readonly SearchResultSource[],
		previewModels: readonly SearchEditorDiffModel[],
	) {
		super();
		for (const preview of previewModels) {
			this.previewModels.set(preview.resource, preview.model);
			this._register(preview.model.onDidChangeContent(() => this.updateResultsModel(preview.model)));
		}
		this._register(this.resultsModel.onDidChangeContent(() => this.updatePreviewModels()));
	}

	private updatePreviewModels(): void {
		this.runSynchronizedUpdate(() => {
			const editsByModel = new Map<ITextModel, { range: Range; text: string }[]>();
			for (const resultLine of parseSearchResultLines(this.resultsModel.getValue(), this.getResultSources())) {
				const previewModel = this.previewModels.get(resultLine.resource);
				if (!previewModel || resultLine.sourceLineNumber > previewModel.getLineCount() || previewModel.getLineContent(resultLine.sourceLineNumber) === resultLine.text) {
					continue;
				}
				const edits = editsByModel.get(previewModel) ?? [];
				edits.push({
					range: new Range(resultLine.sourceLineNumber, 1, resultLine.sourceLineNumber, previewModel.getLineMaxColumn(resultLine.sourceLineNumber)),
					text: resultLine.text,
				});
				editsByModel.set(previewModel, edits);
			}
			for (const [previewModel, edits] of editsByModel) {
				previewModel.pushEditOperations(null, edits, () => null);
			}
		});
	}

	private updateResultsModel(previewModel: ITextModel): void {
		this.runSynchronizedUpdate(() => {
			const edits: { range: Range; text: string }[] = [];
			for (const resultLine of parseSearchResultLines(this.resultsModel.getValue(), this.getResultSources())) {
				if (this.previewModels.get(resultLine.resource) !== previewModel || resultLine.sourceLineNumber > previewModel.getLineCount()) {
					continue;
				}
				const text = previewModel.getLineContent(resultLine.sourceLineNumber);
				if (text !== resultLine.text) {
					edits.push({
						range: new Range(resultLine.resultLineNumber, resultLine.resultStartColumn, resultLine.resultLineNumber, this.resultsModel.getLineMaxColumn(resultLine.resultLineNumber)),
						text,
					});
				}
			}
			if (edits.length > 0) {
				this.resultsModel.pushEditOperations(null, edits, () => null);
			}
		});
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
