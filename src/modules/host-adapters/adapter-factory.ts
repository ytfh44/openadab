/**
 * Adapter Factory — creates adapter instances based on host type.
 *
 * Provides a registration-based factory for host adapters, allowing
 * new adapters to be added without modifying existing code.
 */
import { AdabError } from '../../utils/errors.js';

import type { AdapterBase } from './index.js';

export type AdapterConstructor = new () => AdapterBase;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdapterFactory {

  private static adapters = new Map<string, AdapterConstructor>();

  static register(hostName: string, adapterClass: AdapterConstructor): void {
    this.adapters.set(hostName, adapterClass);
  }

  /**
   * Falls back to the default host if the specified host is not registered.
   *
   * @throws {AdabError} If neither the host nor the default host is registered.
   */
  static create(hostName: string, defaultHost = 'generic'): AdapterBase {
    const AdapterClass = this.adapters.get(hostName);
    if (AdapterClass) {
      return new AdapterClass();
    }

    const DefaultAdapterClass = this.adapters.get(defaultHost);
    if (!DefaultAdapterClass) {
      throw new AdabError(
        `No adapter found for host: ${hostName} and default: ${defaultHost}`,
        'UNKNOWN_ADAPTER'
      );
    }
    return new DefaultAdapterClass();
  }

  static getRegisteredHosts(): string[] {
    return Array.from(this.adapters.keys());
  }

  static isRegistered(hostName: string): boolean {
    return this.adapters.has(hostName);
  }
}
