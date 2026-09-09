/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const SearchEditorDiffScheme = 'search-editor-diff';

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
