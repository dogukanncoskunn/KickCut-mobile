import { NativeModule, requireNativeModule } from 'expo';

import { KickcutEngineModuleEvents } from './KickcutEngine.types';

declare class KickcutEngineModule extends NativeModule<KickcutEngineModuleEvents> {
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<KickcutEngineModule>('KickcutEngine');
