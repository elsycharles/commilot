import chalk from 'chalk';
import { loadConfig } from '../core/ConfigLoader.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import type { ProviderInfo } from '../types/config.js';
import { visibleWidth } from '../ui/DiffDisplay.js';
import { logger } from '../utils/logger.js';

function statusText(info: ProviderInfo): string {
  if (info.status === 'planned') return chalk.dim(`Coming in ${info.version}`);
  if (!info.requiresApiKey) return chalk.green('Ready — no API key needed');
  return info.configured
    ? chalk.green('API key configured')
    : chalk.yellow(`No API key — set COMMILOT_${info.name.toUpperCase()}_KEY`);
}

function marker(info: ProviderInfo): string {
  if (info.status === 'planned') return chalk.dim('○');
  return info.configured ? chalk.green('●') : chalk.yellow('●');
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/** `commilot providers` — list providers with their availability and status. */
export async function providersCommand(cwd: string = process.cwd()): Promise<void> {
  const config = await loadConfig(cwd);
  const providers = ProviderFactory.listProviders(config);

  logger.blank();
  logger.info(`  ${chalk.bold('Available AI Providers:')}`);
  logger.blank();

  const nameWidth = Math.max(...providers.map((info) => info.name.length)) + 12;
  const modelWidth = Math.max(...providers.map((info) => info.model.length)) + 4;

  for (const info of providers) {
    const label = `${info.name}${info.isDefault ? ' (default)' : ''}`;
    const model = info.status === 'available' ? info.model : chalk.dim('—');
    logger.info(
      `  ${marker(info)} ${pad(label, nameWidth)}${pad(model, modelWidth)}${statusText(info)}`,
    );
  }

  logger.blank();
  logger.info(`  Current provider: ${chalk.cyan(config.provider)}`);
  logger.info(`  Change with: ${chalk.dim('commilot config set provider <name>')}`);
  logger.blank();
}
