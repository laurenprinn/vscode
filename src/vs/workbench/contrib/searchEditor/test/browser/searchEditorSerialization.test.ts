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
import { computeSearchResultHash, parseSerializedSearchEditor, serializeSearchConfiguration, serializeSearchResultForEditor, serializeSearchResultHash } from '../../browser/searchEditorSerialization.js';

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

	test('result hash reflects the complete rendered results', async () => {
		const serialize = async (result: ISearchResult) => serializeSearchResultForEditor(result, '', '', 1, uri => uri.path, SearchSortOrder.Default);
		const serialized = [
			await serialize(createSearchResult('needle', 'before')),
			await serialize(createSearchResult('changed', 'before')),
			await serialize(createSearchResult('needle', 'different context')),
			await serialize(createSearchResult('needle', 'before', 'another result')),
		];
		const hashes = serialized.map(value => value.resultHash);
		const sameResultsDifferentQueryHash = (await serialize(createSearchResult('needle', 'before', undefined, 'other'))).resultHash;
		const manuallyEditedResultHash = await computeSearchResultHash(`${serialized[0].text} edited`);
		const textEditorContents = `${serializeSearchConfiguration({ query: 'needle' })}${serializeSearchResultHash(hashes[0])}\n\n${serialized[0].text}`;
		const parsed = parseSerializedSearchEditor(textEditorContents);

		assert.deepStrictEqual({
			searchEditorResultHeader: serialized[0].text.split('\n').slice(0, 2),
			textEditorHeader: textEditorContents.split('\n').slice(0, 4).map(line => line.replace(/[a-f0-9]{64}$/, '<hash>')),
			parsedResultHash: parsed.resultHash?.replace(/[a-f0-9]{64}$/, '<hash>'),
			uniqueHashCount: new Set(hashes).size,
			sameResultsHashMatches: sameResultsDifferentQueryHash === hashes[0],
			manualEditChangesHash: manuallyEditedResultHash !== hashes[0],
		}, {
			searchEditorResultHeader: ['1 result - 1 file', ''],
			textEditorHeader: ['# Query: needle', '# ResultHash: <hash>', '', '1 result - 1 file'],
			parsedResultHash: '<hash>',
			uniqueHashCount: 4,
			sameResultsHashMatches: true,
			manualEditChangesHash: true,
		});
	});
});
