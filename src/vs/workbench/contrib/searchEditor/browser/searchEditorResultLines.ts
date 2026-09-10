/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { linesDiffComputers } from '../../../../editor/common/diff/linesDiffComputers.js';

const searchResultFileLinePattern = /^(?<label>\S.*):$/;
const searchResultElisionPattern = /⟪ (?<characterCount>[0-9]+) characters skipped ⟫/g;

export type SearchResultSource = { label: string; resource: URI };
export type SearchResultLine = { resource: URI; sourceLineNumber: number; resultFileLineNumber: number; resultLineNumber: number; resultStartColumn: number; text: string; kind: 'replace' | 'insert' | 'delete' };
export function getSearchResultInsertAnchorLineNumber(resultLine: SearchResultLine, above: boolean): number {
	if (resultLine.kind === 'insert') {
		return resultLine.sourceLineNumber;
	}
	return above ? Math.max(0, resultLine.sourceLineNumber - 1) : resultLine.sourceLineNumber;
}

export function parseSearchResultLines(text: string, sources: readonly SearchResultSource[]): SearchResultLine[] {
	const sourceByLabel = new Map(sources.map(source => [source.label, source.resource]));
	const resultLinePattern = /^(?<indentation>\s+)(?<lineNumber>\d+)(?<operation>[+-]?)(?<separator>: |  )/;
	const result: SearchResultLine[] = [];
	let resource: URI | undefined;
	let resultFileLineNumber = 0;
	let resultLineNumber = 0;

	for (const line of text.split(/\r?\n/)) {
		resultLineNumber++;
		const fileMatch = searchResultFileLinePattern.exec(line);
		if (fileMatch?.groups) {
			resource = sourceByLabel.get(fileMatch.groups.label);
			resultFileLineNumber = resultLineNumber;
			continue;
		}

		const lineMatch = resultLinePattern.exec(line);
		if (resource && lineMatch?.groups) {
			const sourceLineNumber = Number(lineMatch.groups.lineNumber);
			const kind = lineMatch.groups.operation === '+' ? 'insert' : lineMatch.groups.operation === '-' ? 'delete' : 'replace';
			if (sourceLineNumber < (kind === 'insert' ? 0 : 1)) {
				continue;
			}
			result.push({
				resource,
				sourceLineNumber,
				resultFileLineNumber,
				resultLineNumber,
				resultStartColumn: lineMatch[0].length + 1,
				text: line.slice(lineMatch[0].length),
				kind,
			});
		}
	}

	return result;
}

export function rebaseSearchResultLines(text: string, sources: readonly SearchResultSource[], resources: readonly URI[]): string {
	const textLines = text.split(/\r?\n/);
	const resultLines = parseSearchResultLines(text, sources);
	const rebasedTextLines = new Map<number, string | undefined>();
	for (const resource of resources) {
		const resourceLines = resultLines.filter(line => isEqual(line.resource, resource));
		if (resourceLines.length === 0) {
			continue;
		}

		const deletedLineNumbers = new Set(resourceLines.filter(line => line.kind === 'delete').map(line => line.sourceLineNumber));
		const insertedLines = resourceLines
			.filter(line => line.kind === 'insert')
			.sort((first, second) => first.sourceLineNumber - second.sourceLineNumber || first.resultLineNumber - second.resultLineNumber);
		const rebasedLineNumbers = new Map<SearchResultLine, number>();
		for (const resultLine of resourceLines) {
			if (resultLine.kind === 'delete') {
				continue;
			}
			if (resultLine.kind === 'insert') {
				const deletedThroughAnchor = [...deletedLineNumbers].filter(lineNumber => lineNumber <= resultLine.sourceLineNumber).length;
				const precedingInsertions = insertedLines.findIndex(line => line === resultLine);
				rebasedLineNumbers.set(resultLine, resultLine.sourceLineNumber - deletedThroughAnchor + precedingInsertions + 1);
			} else {
				const precedingDeletions = [...deletedLineNumbers].filter(lineNumber => lineNumber < resultLine.sourceLineNumber).length;
				const precedingInsertions = insertedLines.filter(line => line.sourceLineNumber < resultLine.sourceLineNumber).length;
				rebasedLineNumbers.set(resultLine, resultLine.sourceLineNumber - precedingDeletions + precedingInsertions);
			}
		}

		const lineNumberWidth = Math.max(...[...rebasedLineNumbers.values()].map(lineNumber => lineNumber.toString().length));
		const indentationWidth = Math.min(...resourceLines.map(line => /^\s*/.exec(textLines[line.resultLineNumber - 1])?.[0].length ?? 0));
		for (const resultLine of [...resourceLines].sort((first, second) => second.resultLineNumber - first.resultLineNumber)) {
			const lineIndex = resultLine.resultLineNumber - 1;
			const rebasedLineNumber = rebasedLineNumbers.get(resultLine);
			if (rebasedLineNumber === undefined) {
				rebasedTextLines.set(lineIndex, undefined);
				continue;
			}
			const separator = resultLine.kind === 'insert' ? ': ' : /^\s*\d+[+-]?(?<separator>: |  )/.exec(textLines[lineIndex])?.groups?.separator ?? ': ';
			const indentation = ' '.repeat(indentationWidth + lineNumberWidth - rebasedLineNumber.toString().length);
			rebasedTextLines.set(lineIndex, `${indentation}${rebasedLineNumber}${separator}${resultLine.text}`);
		}
	}
	for (const [lineIndex, rebasedTextLine] of [...rebasedTextLines].sort(([first], [second]) => second - first)) {
		if (rebasedTextLine === undefined) {
			textLines.splice(lineIndex, 1);
		} else {
			textLines[lineIndex] = rebasedTextLine;
		}
	}
	return textLines.join('\n');
}

export function extractSearchResultSourceLabels(text: string): string[] {
	const labels = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const fileMatch = searchResultFileLinePattern.exec(line);
		if (fileMatch?.groups) {
			labels.add(fileMatch.groups.label);
		}
	}
	return [...labels];
}

export function resolveSearchResultLineText(sourceLine: string, resultText: string): string {
	let resolvedText = '';
	let resultOffset = 0;
	let sourceOffset = 0;
	searchResultElisionPattern.lastIndex = 0;
	for (let match: RegExpExecArray | null; (match = searchResultElisionPattern.exec(resultText));) {
		const visibleText = resultText.slice(resultOffset, match.index);
		resolvedText += visibleText;
		sourceOffset += visibleText.length;
		const characterCount = Number(match.groups?.characterCount);
		resolvedText += sourceLine.slice(sourceOffset, sourceOffset + characterCount);
		sourceOffset += characterCount;
		resultOffset = searchResultElisionPattern.lastIndex;
	}
	return resolvedText + resultText.slice(resultOffset);
}

type SearchResultTextChange = { start: number; end: number; text: string };

function getSearchResultTextChange(originalText: string, modifiedText: string): SearchResultTextChange {
	let start = 0;
	while (start < originalText.length && start < modifiedText.length && originalText[start] === modifiedText[start]) {
		start++;
	}

	let suffixLength = 0;
	while (suffixLength < originalText.length - start && suffixLength < modifiedText.length - start && originalText[originalText.length - suffixLength - 1] === modifiedText[modifiedText.length - suffixLength - 1]) {
		suffixLength++;
	}

	return {
		start,
		end: originalText.length - suffixLength,
		text: modifiedText.slice(start, modifiedText.length - suffixLength),
	};
}

export function mergeSearchResultLineText(baselineLine: string, sourceLine: string, resultText: string): { text: string; hasConflict: boolean } {
	const editedLine = resolveSearchResultLineText(baselineLine, resultText);
	if (sourceLine === baselineLine || sourceLine === editedLine) {
		return { text: editedLine, hasConflict: false };
	}
	if (editedLine === baselineLine) {
		return { text: sourceLine, hasConflict: false };
	}

	const sourceChange = getSearchResultTextChange(baselineLine, sourceLine);
	const resultChange = getSearchResultTextChange(baselineLine, editedLine);
	const insertionsCollide = sourceChange.start === sourceChange.end
		&& resultChange.start === resultChange.end
		&& sourceChange.start === resultChange.start;

	if (!insertionsCollide && sourceChange.end <= resultChange.start) {
		const sourceDelta = sourceChange.text.length - (sourceChange.end - sourceChange.start);
		const start = resultChange.start + sourceDelta;
		const end = resultChange.end + sourceDelta;
		return { text: sourceLine.slice(0, start) + resultChange.text + sourceLine.slice(end), hasConflict: false };
	}
	if (!insertionsCollide && resultChange.end <= sourceChange.start) {
		return { text: sourceLine.slice(0, resultChange.start) + resultChange.text + sourceLine.slice(resultChange.end), hasConflict: false };
	}

	return { text: editedLine, hasConflict: true };
}

export function mergeSearchResultLines(baselineLines: readonly string[], sourceLines: readonly string[], resultLines: readonly SearchResultLine[]): { lines: string[]; changed: boolean; hasConflicts: boolean } {
	const intendedLines = applySearchResultLines(baselineLines, resultLines).lines;
	if (intendedLines.length === sourceLines.length && intendedLines.every((line, index) => line === sourceLines[index])) {
		return { lines: [...sourceLines], changed: false, hasConflicts: false };
	}

	const lines = [...sourceLines];
	let changed = false;
	let hasConflicts = false;
	const sourceLineNumbers = mapBaselineToSourceLineNumbers(baselineLines, sourceLines);
	const insertionsByAnchor = new Map<number, SearchResultLine[]>();
	for (const resultLine of resultLines) {
		if (resultLine.kind === 'insert') {
			const insertions = insertionsByAnchor.get(resultLine.sourceLineNumber) ?? [];
			insertions.push(resultLine);
			insertionsByAnchor.set(resultLine.sourceLineNumber, insertions);
		}
	}
	adjustBaselineMappingsForAppliedInsertions(baselineLines, sourceLines, sourceLineNumbers, insertionsByAnchor);
	const handledInsertionAnchors = new Set<number>();
	const sortedResultLines = [...resultLines].sort((first, second) => {
		if (first.sourceLineNumber !== second.sourceLineNumber) {
			return second.sourceLineNumber - first.sourceLineNumber;
		}
		if (first.kind !== second.kind) {
			return first.kind === 'insert' ? -1 : 1;
		}
		return second.resultLineNumber - first.resultLineNumber;
	});

	for (const resultLine of sortedResultLines) {
		if (resultLine.kind === 'insert') {
			if (handledInsertionAnchors.has(resultLine.sourceLineNumber)) {
				continue;
			}
			handledInsertionAnchors.add(resultLine.sourceLineNumber);
			const sourceLineNumber = resultLine.sourceLineNumber === 0 ? 0 : sourceLineNumbers[resultLine.sourceLineNumber - 1];
			if (sourceLineNumber === undefined) {
				hasConflicts = true;
				continue;
			}
			const nextSourceLineNumber = sourceLineNumbers.slice(resultLine.sourceLineNumber).find(lineNumber => lineNumber !== undefined);
			const sourceGapEnd = nextSourceLineNumber === undefined ? sourceLines.length : nextSourceLineNumber - 1;
			const sourceGap = sourceLines.slice(sourceLineNumber, sourceGapEnd);
			const insertedLines = (insertionsByAnchor.get(resultLine.sourceLineNumber) ?? [])
				.sort((first, second) => first.resultLineNumber - second.resultLineNumber)
				.map(line => line.text);
			const mergedGap = mergeInsertedLines(sourceGap, insertedLines);
			lines.splice(sourceLineNumber, sourceGap.length, ...mergedGap);
			continue;
		}

		const sourceLineNumber = sourceLineNumbers[resultLine.sourceLineNumber - 1];
		if (sourceLineNumber === undefined) {
			if (resultLine.kind === 'replace') {
				hasConflicts = true;
			}
			continue;
		}
		const lineIndex = sourceLineNumber - 1;
		const sourceLine = sourceLines[lineIndex];
		const baselineLine = baselineLines[resultLine.sourceLineNumber - 1] ?? sourceLine;
		if (resultLine.kind === 'delete') {
			lines.splice(lineIndex, 1);
			changed = true;
			hasConflicts ||= sourceLine !== baselineLine;
			continue;
		}
		const merged = mergeSearchResultLineText(baselineLine, sourceLine, resultLine.text);
		if (sourceLine !== merged.text) {
			lines[lineIndex] = merged.text;
			changed = true;
		}
		hasConflicts ||= merged.hasConflict;
	}
	changed = lines.length !== sourceLines.length || lines.some((line, index) => line !== sourceLines[index]);
	return { lines, changed, hasConflicts };
}

function adjustBaselineMappingsForAppliedInsertions(
	baselineLines: readonly string[],
	sourceLines: readonly string[],
	sourceLineNumbers: (number | undefined)[],
	insertionsByAnchor: ReadonlyMap<number, readonly SearchResultLine[]>,
): void {
	for (const [anchor, insertions] of [...insertionsByAnchor].sort(([first], [second]) => first - second)) {
		const anchorSourceLineNumber = anchor === 0 ? 0 : sourceLineNumbers[anchor - 1];
		if (anchorSourceLineNumber === undefined) {
			continue;
		}

		const insertedLines = [...insertions]
			.sort((first, second) => first.resultLineNumber - second.resultLineNumber)
			.map(line => line.text);
		let matchedInsertionCount = 0;
		while (matchedInsertionCount < insertedLines.length && sourceLines[anchorSourceLineNumber + matchedInsertionCount] === insertedLines[matchedInsertionCount]) {
			matchedInsertionCount++;
		}
		if (matchedInsertionCount === 0) {
			continue;
		}

		const nextMappedBaselineIndex = sourceLineNumbers.findIndex((lineNumber, index) => index >= anchor && lineNumber !== undefined);
		if (nextMappedBaselineIndex < 0) {
			continue;
		}
		const nextMappedSourceLineNumber = sourceLineNumbers[nextMappedBaselineIndex]!;
		if (nextMappedSourceLineNumber > anchorSourceLineNumber + matchedInsertionCount
			|| sourceLines[nextMappedSourceLineNumber - 1] === baselineLines[nextMappedBaselineIndex]
			|| (sourceLines.length < baselineLines.length + matchedInsertionCount
				&& sourceLines[anchorSourceLineNumber + matchedInsertionCount] !== baselineLines[nextMappedBaselineIndex])) {
			continue;
		}

		for (let index = anchor; index < sourceLineNumbers.length; index++) {
			const sourceLineNumber = sourceLineNumbers[index];
			if (sourceLineNumber !== undefined) {
				sourceLineNumbers[index] = sourceLineNumber + matchedInsertionCount;
			}
		}
	}
}

function mergeInsertedLines(sourceLines: readonly string[], insertedLines: readonly string[]): string[] {
	const lengths = Array.from({ length: insertedLines.length + 1 }, () => new Array<number>(sourceLines.length + 1).fill(0));
	for (let insertedIndex = insertedLines.length - 1; insertedIndex >= 0; insertedIndex--) {
		for (let sourceIndex = sourceLines.length - 1; sourceIndex >= 0; sourceIndex--) {
			lengths[insertedIndex][sourceIndex] = insertedLines[insertedIndex] === sourceLines[sourceIndex]
				? lengths[insertedIndex + 1][sourceIndex + 1] + 1
				: Math.max(lengths[insertedIndex + 1][sourceIndex], lengths[insertedIndex][sourceIndex + 1]);
		}
	}

	const result: string[] = [];
	let insertedIndex = 0;
	let sourceIndex = 0;
	while (insertedIndex < insertedLines.length && sourceIndex < sourceLines.length) {
		if (insertedLines[insertedIndex] === sourceLines[sourceIndex]) {
			result.push(sourceLines[sourceIndex]);
			insertedIndex++;
			sourceIndex++;
		} else if (lengths[insertedIndex + 1][sourceIndex] >= lengths[insertedIndex][sourceIndex + 1]) {
			result.push(insertedLines[insertedIndex++]);
		} else {
			result.push(sourceLines[sourceIndex++]);
		}
	}
	result.push(...insertedLines.slice(insertedIndex), ...sourceLines.slice(sourceIndex));
	return result;
}

function mapBaselineToSourceLineNumbers(baselineLines: readonly string[], sourceLines: readonly string[]): (number | undefined)[] {
	const result = baselineLines.map((_, index) => index + 1 as number | undefined);
	const diff = linesDiffComputers.getLegacy().computeDiff(
		[...baselineLines],
		[...sourceLines],
		{ ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false }
	);
	let delta = 0;
	for (const change of diff.changes) {
		const originalLength = change.original.length;
		const modifiedLength = change.modified.length;
		for (let lineNumber = change.original.startLineNumber; lineNumber < change.original.endLineNumberExclusive; lineNumber++) {
			const offset = lineNumber - change.original.startLineNumber;
			result[lineNumber - 1] = offset < modifiedLength ? change.modified.startLineNumber + offset : undefined;
		}
		for (let lineNumber = change.original.endLineNumberExclusive; lineNumber <= baselineLines.length; lineNumber++) {
			result[lineNumber - 1] = lineNumber + delta + modifiedLength - originalLength;
		}
		delta += modifiedLength - originalLength;
	}
	return result;
}

export function applySearchResultLines(sourceLines: readonly string[], resultLines: readonly SearchResultLine[]): { lines: string[]; changed: boolean } {
	const lines = [...sourceLines];
	let changed = false;
	for (const resultLine of [...resultLines].sort((first, second) => second.sourceLineNumber - first.sourceLineNumber || second.resultLineNumber - first.resultLineNumber)) {
		if (resultLine.kind === 'insert') {
			if (resultLine.sourceLineNumber <= lines.length) {
				lines.splice(resultLine.sourceLineNumber, 0, resultLine.text);
				changed = true;
			}
			continue;
		}
		if (resultLine.sourceLineNumber < 1 || resultLine.sourceLineNumber > sourceLines.length) {
			continue;
		}
		if (resultLine.kind === 'delete') {
			lines.splice(resultLine.sourceLineNumber - 1, 1);
			changed = true;
			continue;
		}
		const sourceLine = sourceLines[resultLine.sourceLineNumber - 1];
		const resultText = resolveSearchResultLineText(sourceLine, resultLine.text);
		if (sourceLine !== resultText) {
			lines[resultLine.sourceLineNumber - 1] = resultText;
			changed = true;
		}
	}
	return { lines, changed };
}
