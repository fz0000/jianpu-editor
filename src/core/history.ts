import { cloneScore, type Score } from './model';

/** 基于快照的撤销/重做栈（乐谱体量小，快照最稳妥） */
export class History {
  private undoStack: Score[] = [];
  private redoStack: Score[] = [];
  private readonly limit: number;

  constructor(limit = 120) {
    this.limit = limit;
  }

  push(snapshot: Score): void {
    this.undoStack.push(cloneScore(snapshot));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(current: Score): Score | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneScore(current));
    return prev;
  }

  redo(current: Score): Score | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneScore(current));
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
