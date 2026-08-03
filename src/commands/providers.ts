import chalk from 'chalk';
import { loadConfig } from '../core/ConfigLoader.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import type { ProviderInfo } from '../types/config.js';
import { visibleWidth } from '../ui/DiffDisplay.js';
import { logger } from '../utils/logger.js';

function statusText(info: ProviderInfo): string {
  if (info.status === 'planned') return chalk.dim(`Coming in ${info.version}`);
  if (!info.enabled) {
    return chalk.dim(`Off — commilot config set ${info.name}.enabled true`);
  }
  if (!info.requiresApiKey) return chalk.green('Ready — no API key needed');
  return info.configured
    ? chalk.green('API key configured')
    : chalk.yellow(`No API key — set COMMILOT_${info.name.toUpperCase()}_KEY`);
}

function marker(info: ProviderInfo): string {
  if (info.status === 'planned' || !info.enabled) return chalk.dim('○');
  return info.configured ? chalk.green('●') : chalk.yellow('●');
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/** `commilot providers` — list providers with their availability and status. */
export async function providersCommand(cwd: string = process.cwd()): Promise<void> {
  const config = await loadConfig(cwd);
  // Only what the user can actually select. The other backends exist in the
  // codebase but are not part of the product surface.
  const providers = ProviderFactory.listProviders(config).filter((info) => info.enabled);

  logger.blank();
  logger.info(`  ${chalk.bold('Model backend')}`);
  logger.blank();

  const nameWidth = Math.max(...providers.map((info) => info.name.length)) + 12;
  const modelWidth = Math.max(...providers.map((info) => info.model.length)) + 4;

  for (const info of providers) {
    const label = `${info.name}${info.isDefault ? ' (default)' : ''}`;
    const model = info.status === 'available' && info.enabled ? info.model : chalk.dim('—');
    logger.info(
      `  ${marker(info)} ${pad(label, nameWidth)}${pad(model, modelWidth)}${statusText(info)}`,
    );
  }

  logger.blank();
  logger.info(`  Change the model: ${chalk.dim('commilot config set ollama.model <name>')}`);
  logger.info(`  Just for one run: ${chalk.dim('commilot --model <name>')}`);
  logger.info(`  Your installed models: ${chalk.dim('ollama list')}`);
  logger.blank();
}
