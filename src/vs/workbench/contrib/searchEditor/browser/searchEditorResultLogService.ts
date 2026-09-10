/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { AbstractLogger, ILogger, ILoggerService } from '../../../../platform/log/common/log.js';

export const ISearchEditorResultLogService = createDecorator<ISearchEditorResultLogService>('searchEditorResultLogService');

export interface ISearchEditorResultLogService extends ILogger {
	readonly _serviceBrand: undefined;
}

export class SearchEditorResultLogService extends AbstractLogger implements ISearchEditorResultLogService {

	declare readonly _serviceBrand: undefined;
	private readonly logger: ILogger;

	constructor(
		@ILoggerService loggerService: ILoggerService,
	) {
		super();
		this.logger = this._register(loggerService.createLogger('searchEditorResult', { name: localize('searchEditorResultLog', "Search Editor Result") }));
	}

	trace(message: string, ...args: unknown[]): void {
		this.logger.trace(message, ...args);
	}

	debug(message: string, ...args: unknown[]): void {
		this.logger.debug(message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.logger.info(message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.logger.warn(message, ...args);
	}

	error(message: string | Error, ...args: unknown[]): void {
		this.logger.error(message, ...args);
	}

	flush(): void {
		this.logger.flush();
	}
}
