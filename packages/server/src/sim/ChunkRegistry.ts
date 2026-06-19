import { CHUNK_ID } from '@rms/shared';
import { Chunk } from './Chunk';

/**
 * Phase 0 has exactly one chunk; this registry is the only indirection between
 * "one chunk" and "many" (§4.3). Phase 2 grows it to many chunks (and, later,
 * many sim processes) without touching the chunk or sim-loop internals.
 */
export class ChunkRegistry {
  private readonly chunks = new Map<number, Chunk>();

  constructor() {
    this.chunks.set(CHUNK_ID, new Chunk());
  }

  get(id: number): Chunk | undefined {
    return this.chunks.get(id);
  }

  /** The single Phase 0 chunk. */
  get primary(): Chunk {
    return this.chunks.get(CHUNK_ID)!;
  }

  all(): IterableIterator<Chunk> {
    return this.chunks.values();
  }
}
