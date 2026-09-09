/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

const searchResultFileLinePattern = /^(?<label>\S.*):$/;

export type SearchResultSource = { label: string; resource: URI };
export type SearchResultLine = { resource: URI; sourceLineNumber: number; resultLineNumber: number; resultStartColumn: number; text: string };

export function parseSearchResultLines(text: string, sources: readonly SearchResultSource[]): SearchResultLine[] {
	const sourceByLabel = new Map(sources.map(source => [source.label, source.resource]));
	const resultLinePattern = /^(?<indentation>\s+)(?<lineNumber>\d+)(?<separator>: |  )/;
	const result: SearchResultLine[] = [];
	let resource: URI | undefined;
	let resultLineNumber = 0;

	for (const line of text.split(/\r?\n/)) {
		resultLineNumber++;
		const fileMatch = searchResultFileLinePattern.exec(line);
		if (fileMatch?.groups) {
			resource = sourceByLabel.get(fileMatch.groups.label);
			continue;
		}

		const lineMatch = resultLinePattern.exec(line);
		if (resource && lineMatch?.groups) {
			const sourceLineNumber = Number(lineMatch.groups.lineNumber);
			if (sourceLineNumber < 1) {
				continue;
			}
			result.push({
				resource,
				sourceLineNumber,
				resultLineNumber,
				resultStartColumn: lineMatch[0].length + 1,
				text: line.slice(lineMatch[0].length)
			});
		}
	}

	return result;
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

export function applySearchResultLines(sourceLines: readonly string[], resultLines: readonly SearchResultLine[]): { lines: string[]; changed: boolean } {
	const lines = [...sourceLines];
	let changed = false;
	for (const resultLine of resultLines) {
		if (resultLine.sourceLineNumber < 1 || resultLine.sourceLineNumber > lines.length) {
			continue;
		}
		if (lines[resultLine.sourceLineNumber - 1] !== resultLine.text) {
			lines[resultLine.sourceLineNumber - 1] = resultLine.text;
			changed = true;
		}
	}
	return { lines, changed };
}
