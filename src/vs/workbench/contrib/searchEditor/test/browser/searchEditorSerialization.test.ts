/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextQuery, OneLineRange, QueryType, SearchSortOrder } from '../../../../services/search/common/search.js';
import { ISearchResult, ISearchTreeFileMatch, ISearchTreeFolderMatch, ISearchTreeMatch } from '../../../search/browser/searchTreeModel/searchTreeCommon.js';
import { applySearchResultLines, computeSearchResultHash, extractSearchResultSourceLabels, parseSearchResultLines, parseSerializedSearchEditor, serializeSearchConfiguration, serializeSearchResultForEditor } from '../../browser/searchEditorSerialization.js';

suite('SearchEditorSerialization', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createSearchResult(resultText: string, contextText: string, additionalResultText?: string, query = 'needle'): ISearchResult {
		const matches: ISearchTreeMatch[] = [
			new class extends mock<ISearchTreeMatch>() {
				override range = () => new Range(2, 1, 2, resultText.length + 1);
				override rangeInPreview = () => new OneLineRange(0, 0, resultText.length);
				override fullPreviewLines = () => [resultText];
			},
		];
		if (additionalResultText) {
			const text = additionalResultText;
			matches.push(new class extends mock<ISearchTreeMatch>() {
				override range = () => new Range(4, 1, 4, text.length + 1);
				override rangeInPreview = () => new OneLineRange(0, 0, text.length);
				override fullPreviewLines = () => [text];
			});
		}
		const fileMatch = new class extends mock<ISearchTreeFileMatch>() {
			override resource = URI.file('/file.txt');
			override context = new Map([[1, contextText], [3, 'after']]);
			override textMatches = () => matches;
		};
		const folderMatch = new class extends mock<ISearchTreeFolderMatch>() {
			override allDownstreamFileMatches = () => [fileMatch];
		};
		return new class extends mock<ISearchResult>() {
			override query: ITextQuery = { type: QueryType.Text, folderQueries: [], contentPattern: { pattern: query } };
			override count = () => matches.length;
			override fileCount = () => 1;
			override folderMatches = () => [folderMatch];
		};
	}

	test('edited results map to source lines', async () => {
		const serialize = async (result: ISearchResult) => serializeSearchResultForEditor(result, '', '', 1, uri => uri.path, SearchSortOrder.Default);
		const serialized = await serialize(createSearchResult('needle', 'before'));
		const textEditorContents = `${serializeSearchConfiguration({ query: 'needle' })}\n${serialized.text}`;
		const parsed = parseSerializedSearchEditor(textEditorContents);
		const editedText = serialized.text.replace('  2: needle', '  2: replacement');
		const parsedLines = parseSearchResultLines(editedText, serialized.sources);
		const applied = applySearchResultLines(['before', 'needle', 'after', 'unchanged'], parsedLines);
		const [resultHash, sourceHash] = await Promise.all([
			computeSearchResultHash('replacement'),
			computeSearchResultHash('needle'),
		]);

		assert.deepStrictEqual({
			searchEditorResultHeader: serialized.text.split('\n').slice(0, 2),
			textEditorHeader: textEditorContents.split('\n').slice(0, 3),
			parsedQuery: parsed.config.query,
			sourceLabels: extractSearchResultSourceLabels(parsed.text),
			hashesDiffer: resultHash !== sourceHash,
			parsedLines: parsedLines.map(line => ({ resource: line.resource.path, lineNumber: line.sourceLineNumber, text: line.text })),
			applied,
		}, {
			searchEditorResultHeader: ['1 result - 1 file', ''],
			textEditorHeader: ['# Query: needle', '', '1 result - 1 file'],
			parsedQuery: 'needle',
			sourceLabels: ['/file.txt'],
			hashesDiffer: true,
			parsedLines: [
				{ resource: '/file.txt', lineNumber: 1, text: 'before' },
				{ resource: '/file.txt', lineNumber: 2, text: 'replacement' },
				{ resource: '/file.txt', lineNumber: 3, text: 'after' },
			],
			applied: { lines: ['before', 'replacement', 'after', 'unchanged'], changed: true },
		});
	});
});
