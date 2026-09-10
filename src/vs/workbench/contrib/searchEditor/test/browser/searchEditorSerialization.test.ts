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
import { applySearchResultLines, computeSearchResultHash, extractSearchResultSourceLabels, getSearchResultInsertAnchorLineNumber, mergeSearchResultLines, mergeSearchResultLineText, parseSearchResultLines, parseSerializedSearchEditor, rebaseSearchResultLines, serializeSearchConfiguration, serializeSearchResultForEditor } from '../../browser/searchEditorSerialization.js';

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
			parsedLines: parsedLines.map(line => ({ resource: line.resource.path, sourceLineNumber: line.sourceLineNumber, resultFileLineNumber: line.resultFileLineNumber, resultLineNumber: line.resultLineNumber, resultStartColumn: line.resultStartColumn, text: line.text, kind: line.kind })),
			applied,
		}, {
			searchEditorResultHeader: ['1 result - 1 file', ''],
			textEditorHeader: ['# Query: needle', '', '1 result - 1 file'],
			parsedQuery: 'needle',
			sourceLabels: ['/file.txt'],
			hashesDiffer: true,
			parsedLines: [
				{ resource: '/file.txt', sourceLineNumber: 1, resultFileLineNumber: 3, resultLineNumber: 4, resultStartColumn: 6, text: 'before', kind: 'replace' },
				{ resource: '/file.txt', sourceLineNumber: 2, resultFileLineNumber: 3, resultLineNumber: 5, resultStartColumn: 6, text: 'replacement', kind: 'replace' },
				{ resource: '/file.txt', sourceLineNumber: 3, resultFileLineNumber: 3, resultLineNumber: 6, resultStartColumn: 6, text: 'after', kind: 'replace' },
			],
			applied: { lines: ['before', 'replacement', 'after', 'unchanged'], changed: true },
		});
	});

	test('parses and merges inserted and deleted result lines', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines([
			'/file.txt:',
			'  0+: before all',
			'  1+: inserted first',
			'  1+: inserted second',
			'  2-: beta',
			'  3: gamma edited',
		].join('\n'), sources);
		const merged = mergeSearchResultLines(
			['alpha', 'beta', 'gamma'],
			['source prefix', 'alpha', 'beta', 'gamma'],
			resultLines,
		);

		assert.deepStrictEqual({
			parsed: resultLines.map(line => ({ sourceLineNumber: line.sourceLineNumber, kind: line.kind, text: line.text })),
			merged,
		}, {
			parsed: [
				{ sourceLineNumber: 0, kind: 'insert', text: 'before all' },
				{ sourceLineNumber: 1, kind: 'insert', text: 'inserted first' },
				{ sourceLineNumber: 1, kind: 'insert', text: 'inserted second' },
				{ sourceLineNumber: 2, kind: 'delete', text: 'beta' },
				{ sourceLineNumber: 3, kind: 'replace', text: 'gamma edited' },
			],
			merged: {
				lines: ['before all', 'source prefix', 'alpha', 'inserted first', 'inserted second', 'gamma edited'],
				changed: true,
				hasConflicts: false,
			},
		});
	});

	test('deleting a source-modified line reports a conflict', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  2-: beta', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta'], ['alpha', 'beta changed'], resultLines),
			{ lines: ['alpha'], changed: true, hasConflicts: true },
		);
	});

	test('maps an insertion after the final baseline line', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  2+: omega', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta'], ['prefix', 'alpha', 'beta'], resultLines),
			{ lines: ['prefix', 'alpha', 'beta', 'omega'], changed: true, hasConflicts: false },
		);
	});

	test('recognizes a lone inserted result line as an unapplied change', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: alpha\n  2: beta\n  2+: new line\n  3: gamma', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta', 'gamma'], ['alpha', 'beta', 'gamma'], resultLines),
			{ lines: ['alpha', 'beta', 'new line', 'gamma'], changed: true, hasConflicts: false },
		);
	});

	test('does not mistake a source replacement for an applied insertion', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: alpha\n  1+: replacement\n  2: beta', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta'], ['alpha', 'replacement'], resultLines),
			{ lines: ['alpha', 'replacement', 'replacement'], changed: true, hasConflicts: false },
		);
	});

	test('reports a conflict when an insertion anchor was deleted from the source', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  2+: omega', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta'], ['alpha'], resultLines),
			{ lines: ['alpha'], changed: false, hasConflicts: true },
		);
	});

	test('structural changes are no longer pending after application', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  2-: beta\n  2+: inserted', sources);

		assert.deepStrictEqual(
			mergeSearchResultLines(['alpha', 'beta', 'gamma'], ['alpha', 'inserted', 'gamma'], resultLines),
			{ lines: ['alpha', 'inserted', 'gamma'], changed: false, hasConflicts: false },
		);
	});

	test('rebases applied structural changes before another insertion', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const firstResultText = '/file.txt:\n  1: alpha\n  2-: beta\n  2+: inserted first\n  3: gamma';
		const firstResultLines = parseSearchResultLines(firstResultText, sources);
		const baselineLines = ['alpha', 'beta', 'gamma'];
		const firstApply = mergeSearchResultLines(baselineLines, baselineLines, firstResultLines);
		const rebasedResultText = rebaseSearchResultLines(firstResultText, sources, [sources[0].resource]);
		const secondResultText = '/file.txt:\n  1: alpha\n  2: inserted first\n  2+: inserted second\n  3: gamma';
		const secondResultLines = parseSearchResultLines(secondResultText, sources);
		const secondApply = mergeSearchResultLines(firstApply.lines, firstApply.lines, secondResultLines);

		assert.deepStrictEqual({
			firstApply,
			rebasedResultText,
			secondApply,
			secondRebase: rebaseSearchResultLines(secondResultText, sources, [sources[0].resource]),
		}, {
			firstApply: { lines: ['alpha', 'inserted first', 'gamma'], changed: true, hasConflicts: false },
			rebasedResultText: '/file.txt:\n  1: alpha\n  2: inserted first\n  3: gamma',
			secondApply: { lines: ['alpha', 'inserted first', 'inserted second', 'gamma'], changed: true, hasConflicts: false },
			secondRebase: '/file.txt:\n  1: alpha\n  2: inserted first\n  3: inserted second\n  4: gamma',
		});
	});

	test('rebases structural changes in multiple files', () => {
		const sources = [
			{ label: '/first.txt', resource: URI.file('/first.txt') },
			{ label: '/second.txt', resource: URI.file('/second.txt') },
		];
		const resultText = '/first.txt:\n  1: alpha\n  2-: beta\n/second.txt:\n  9: nine\n  9+: ten';

		assert.strictEqual(
			rebaseSearchResultLines(resultText, sources, sources.map(source => source.resource)),
			'/first.txt:\n  1: alpha\n/second.txt:\n   9: nine\n  10: ten',
		);
	});

	test('applied insertions are not inserted again', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1+: inserted first\n  1+: inserted second', sources);

		assert.deepStrictEqual({
			partiallyApplied: mergeSearchResultLines(['alpha', 'beta'], ['alpha', 'inserted first', 'beta'], resultLines),
			fullyApplied: mergeSearchResultLines(['alpha', 'beta'], ['alpha', 'inserted first', 'inserted second', 'beta'], resultLines),
		}, {
			partiallyApplied: { lines: ['alpha', 'inserted first', 'inserted second', 'beta'], changed: true, hasConflicts: false },
			fullyApplied: { lines: ['alpha', 'inserted first', 'inserted second', 'beta'], changed: false, hasConflicts: false },
		});
	});

	test('applied empty insertions are not reported as changes', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: alpha\n  2+: \n  2+: \n  3: gamma', sources);
		const assertApplied = (baselineLines: string[], sourceLines: string[]) => ({
			merged: mergeSearchResultLines(baselineLines, sourceLines, resultLines),
			changedLines: resultLines.map(line => mergeSearchResultLines(baselineLines, sourceLines, [line]).changed),
		});

		assert.deepStrictEqual({
			nonEmptyAnchor: assertApplied(['alpha', 'beta', 'gamma'], ['alpha', 'beta', '', '', 'gamma']),
			emptyAnchor: assertApplied(['alpha', '', 'gamma'], ['alpha', '', '', '', 'gamma']),
			trailingNewline: assertApplied(['alpha', 'beta', 'gamma', ''], ['alpha', 'beta', '', '', 'gamma', '']),
		}, {
			nonEmptyAnchor: {
				merged: { lines: ['alpha', 'beta', '', '', 'gamma'], changed: false, hasConflicts: false },
				changedLines: [false, false, false, false],
			},
			emptyAnchor: {
				merged: { lines: ['alpha', '', '', '', 'gamma'], changed: false, hasConflicts: false },
				changedLines: [false, false, false, false],
			},
			trailingNewline: {
				merged: { lines: ['alpha', 'beta', '', '', 'gamma', ''], changed: false, hasConflicts: false },
				changedLines: [false, false, false, false],
			},
		});
	});

	test('empty insertions with a replacement are applied only once', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: alpha\n  2+: \n  2+: \n  3: gamma', sources);
		const baselineLines = ['alpha', 'beta', 'ljhglhjg', '', 'gamma'];
		const firstApply = mergeSearchResultLines(baselineLines, baselineLines, resultLines);

		assert.deepStrictEqual({
			firstApply,
			secondApply: mergeSearchResultLines(baselineLines, firstApply.lines, resultLines),
		}, {
			firstApply: { lines: ['alpha', 'beta', '', '', 'gamma', '', 'gamma'], changed: true, hasConflicts: false },
			secondApply: { lines: ['alpha', 'beta', '', '', 'gamma', '', 'gamma'], changed: false, hasConflicts: false },
		});
	});

	test('empty insertions with a replacement remain applied after an external insertion', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: alpha\n  2+: \n  2+: \n  3: gamma', sources);
		const baselineLines = ['alpha', 'beta', 'ljhglhjg', '', 'gamma'];
		const firstApply = mergeSearchResultLines(baselineLines, ['alpha', 'test', 'beta', 'ljhglhjg', '', 'gamma'], resultLines);
		const previouslyDuplicatedSource = ['alpha', 'test', 'beta', '', 'gamma', 'gamma', 'gamma', 'gamma', 'gamma', '', 'gamma'];
		const repairedDuplicatedSource = mergeSearchResultLines(baselineLines, previouslyDuplicatedSource, resultLines);

		assert.deepStrictEqual({
			firstApply,
			secondApply: mergeSearchResultLines(baselineLines, firstApply.lines, resultLines),
			repairedDuplicatedSource,
			repairedDuplicatedSourceSecondApply: mergeSearchResultLines(baselineLines, repairedDuplicatedSource.lines, resultLines),
		}, {
			firstApply: { lines: ['alpha', 'test', 'beta', '', '', 'gamma', '', 'gamma'], changed: true, hasConflicts: false },
			secondApply: { lines: ['alpha', 'test', 'beta', '', '', 'gamma', '', 'gamma'], changed: false, hasConflicts: false },
			repairedDuplicatedSource: { lines: ['alpha', 'test', 'beta', '', '', 'gamma', 'gamma', 'gamma', 'gamma', 'gamma', '', 'gamma'], changed: true, hasConflicts: false },
			repairedDuplicatedSourceSecondApply: { lines: ['alpha', 'test', 'beta', '', '', 'gamma', 'gamma', 'gamma', 'gamma', 'gamma', '', 'gamma'], changed: false, hasConflicts: false },
		});
	});

	test('elided result lines preserve skipped source text', () => {
		const sourceLine = `${'x'.repeat(822)}restOfLine`;
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const unchangedLine = parseSearchResultLines('/file.txt:\n  1: ⟪ 822 characters skipped ⟫restOfLine', sources);
		const editedLine = parseSearchResultLines('/file.txt:\n  1: ⟪ 822 characters skipped ⟫changed', sources);

		assert.deepStrictEqual({
			unchanged: applySearchResultLines([sourceLine], unchangedLine),
			edited: applySearchResultLines([sourceLine], editedLine),
		}, {
			unchanged: { lines: [sourceLine], changed: false },
			edited: { lines: [`${'x'.repeat(822)}changed`], changed: true },
		});
	});

	test('merges non-overlapping source and search result changes', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const resultLines = parseSearchResultLines('/file.txt:\n  1: const value = new;', sources);
		assert.deepStrictEqual({
			unchangedSource: mergeSearchResultLineText('const value = old;', 'const value = old;', 'const value = new;'),
			unchangedResult: mergeSearchResultLineText('const value = old;', 'export const value = old;', 'const value = old;'),
			sourceChangeBeforeResult: mergeSearchResultLineText('const value = old;', 'export const value = old;', 'const value = new;'),
			sourceChangeAfterResult: mergeSearchResultLineText('const value = old;', 'const value = old; // source', 'let value = old;'),
			overlappingChanges: mergeSearchResultLineText('const value = old;', 'const value = source;', 'const value = result;'),
			mergedLines: mergeSearchResultLines(['const value = old;'], ['export const value = old;'], resultLines),
		}, {
			unchangedSource: { text: 'const value = new;', hasConflict: false },
			unchangedResult: { text: 'export const value = old;', hasConflict: false },
			sourceChangeBeforeResult: { text: 'export const value = new;', hasConflict: false },
			sourceChangeAfterResult: { text: 'let value = old; // source', hasConflict: false },
			overlappingChanges: { text: 'const value = result;', hasConflict: true },
			mergedLines: { lines: ['export const value = new;'], changed: true, hasConflicts: false },
		});
	});

	test('keeps repeated insertions on the same baseline anchor', () => {
		const sources = [{ label: '/file.txt', resource: URI.file('/file.txt') }];
		const [sourceLine, insertedLine] = parseSearchResultLines('/file.txt:\n  1: alpha\n  1+: inserted', sources);

		assert.deepStrictEqual({
			sourceAbove: getSearchResultInsertAnchorLineNumber(sourceLine, true),
			sourceBelow: getSearchResultInsertAnchorLineNumber(sourceLine, false),
			insertAbove: getSearchResultInsertAnchorLineNumber(insertedLine, true),
			insertBelow: getSearchResultInsertAnchorLineNumber(insertedLine, false),
		}, {
			sourceAbove: 0,
			sourceBelow: 1,
			insertAbove: 1,
			insertBelow: 1,
		});
	});
});
