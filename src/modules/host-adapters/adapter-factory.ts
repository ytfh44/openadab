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

  /**
   * Register an adapter constructor for a host name.
   *
   * Existing registrations with the same host name are overwritten.  This
   * mirrors the semantics of `Map.set` and is intentional — tests rely on
   * being able to replace stubs.
   *
   * @param hostName     Stable identifier used in `--host <name>` CLI flags
   *                     and in the {@link detectHost} return value.
   * @param adapterClass Constructor that produces an {@link AdapterBase}.
   */
  static register(hostName: string, adapterClass: AdapterConstructor): void {
    this.adapters.set(hostName, adapterClass);
  }

  /**
   * Create an adapter instance for the requested host.
   *
   * When `hostName` is not registered, falls back to `defaultHost` and
   * emits a warning (HA-12) so silent fallback is auditable.  When
   * `hostName` is an empty string the fallback is also silent because
   * the caller is the explicit "no host detected" path.
   *
   * @param hostName     The requested host.  Pass `''` to skip the warning.
   * @param defaultHost  Fallback host used when `hostName` is unknown.
   * @returns A new adapter instance.
   * @throws {AdabError} If neither `hostName` nor `defaultHost` is registered.
   */
  static create(hostName: string, defaultHost = 'generic'): AdapterBase {
    const AdapterClass = this.adapters.get(hostName);
    if (AdapterClass) {
      return new AdapterClass();
    }

    if (hostName !== '' && hostName !== defaultHost) {
      console.warn(
        `[AdapterFactory] No adapter registered for host "${hostName}"; ` +
        `falling back to default host "${defaultHost}". ` +
        `Use \`openadab update --host <name>\` to target a specific host.`
      );
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

  /**
   * List the host names currently registered with the factory.
   *
   * @returns A new array of host names in registration order.
   */
  static getRegisteredHosts(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Test whether a host name is currently registered.
   *
   * @param hostName Host name to test.
   * @returns `true` when the name has been registered.
   */
  static isRegistered(hostName: string): boolean {
    return this.adapters.has(hostName);
  }

  /**
   * Clear every registered adapter.
   *
   * Intended for unit tests (HA-5) so they can build a clean registry
   * with {@link initRegistry} and inject stubs without leaking state
   * between test files.  Production code MUST NOT call this.
   */
  static _resetForTests(): void {
    this.adapters.clear();
  }
}
