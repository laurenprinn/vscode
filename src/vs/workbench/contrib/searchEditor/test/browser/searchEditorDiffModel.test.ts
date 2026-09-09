/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { SearchEditorDiffContentProvider, SearchEditorDiffScheme } from '../../browser/searchEditorDiffModel.js';

suite('SearchEditorDiffModel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

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
});
