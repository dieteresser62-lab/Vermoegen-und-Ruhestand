/** Gemeinsame Dialog- und Seitengrenzen; bestehende DOM- und Speicherverträge bleiben maßgeblich. */
import type * as D from './datenvertraege.js';
import type * as I from './speicher-integration.js';
export interface PageDialogOptions {
    title?: string; description?: string; doc?: Document; signal?: AbortSignal; opener?: EventTarget;
    returnFocus?: ()=>void; id?: string; cancelled?: unknown; queue?: boolean; createDialog?: ()=>HTMLDialogElement;
}
export interface DialogContext {
    dialog: HTMLDialogElement; doc: Document; finish(result?: unknown, error?: unknown): void; reject(error: unknown): void;
    listen(node: EventTarget, type: string, handler: (event: DialogEvent)=>unknown, removers?: (()=>void)[]): void;
}
/** Die gemeinsam registrierten Listener lesen je nach Ereignis Tastatur- oder Mausfelder. */
export type DialogEvent = Event & Partial<Pick<KeyboardEvent, 'key'|'shiftKey'>> & {target: Element};
export type DialogControl = HTMLElement & {disabled?: boolean};
export interface DialogBehavior {controls(): DialogControl[]; initialFocus?: HTMLElement; blocked?(): boolean; cleanup?(): void;}
export interface SimpleDialogOptions extends PageDialogOptions {
    label?: string; options?: {value: string|number; label: string}[]; value?: string|number; defaultValue?: string|number;
    confirmLabel?: string; cancelLabel?: string; danger?: boolean; required?: boolean; validate?: (value: string)=>boolean|string|void;
}
export interface ChoiceRow {id: string; label: string; kind?: string; selected?: string|number; required?: boolean; refreshRows?: boolean; options: {value: string|number; label: string; suggested?: boolean}[];}
export interface ChoiceOptions extends PageDialogOptions {
    rows?: ChoiceRow[]; updateRows?: (values: Record<string,string>)=>ChoiceRow[];
    onConfirm?: (values: Readonly<Record<string,string>>)=>unknown|Promise<unknown>;
    confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}
/** Die rekursive Fokusprüfung unterstützt zusätzlich die vorhandenen DOM-Testdoubles. */
export type CloseElement = HTMLElement & {tag?: string; parent?: CloseElement; disabled?: boolean; open?: boolean; type?: string; href?: string};
export interface CloseStep {id: string; title: string; chip?: string; locked?: boolean; awaitingYear?: boolean; nextAction?: boolean;
    state?: string; done?: boolean; progressByVisit?: boolean; preparing?: boolean; prepared?: boolean; statusLabel?: string;
    result?: string; resultTone?: string; continueLabel?: string; content?: Node; contentOwnResult?: boolean; nextDisabled?: boolean; onNext?: ()=>boolean|void;}
export interface CloseDialogOptions {doc?: Document; id?: string; title?: string; eyebrow?: string; subtitle?: string;
    progressNames?: string|null; footnote?: string; steps?: CloseStep[]; actions?: HTMLElement[]; groupBefore?: Record<string,string>;
    signal?: AbortSignal; returnFocus?: ()=>void; onClose?: ()=>boolean|Promise<boolean>;}
export interface CloseMessageOptions {kind?: string; action?: {label: string; onActivate(isCurrent: ()=>boolean): unknown|Promise<unknown>};}
export interface CloseResultOptions {doc?: Document; month?: string; nextMonth?: string; expenses?: string; budgetComparison?: string;
    people?: {name: string; value: string; status?: string}[]; cashTotal?: string; withdrawal?: string; withdrawalLabel?: string;
    withdrawalDetail?: string; budgetTone?: string; actionSection?: Node; yearSection?: Node; successText?: string;
    expensesAmount?: string; budgetAmount?: string; budgetSource?: string; withdrawalFixed?: boolean;}
export interface CloseProgressModel {members?: {id: string; name: string}[]; expenses?: {rows?: {id: string; present: boolean; spent?: number}[]; complete?: boolean; spent?: number|null};}
export type PlanField = HTMLInputElement & {options?: HTMLOptionsCollection};
export interface PlanFormatOptions {editing?: boolean; includeUnit?: boolean; fractionDigits?: number;}
export interface PlanFocusState {correctionChanged?: boolean; blurredField?: HTMLElement; relatedTarget?: Node|null;}
export interface PlanFieldBindingOptions extends PlanFormatOptions {doc?: Document; field?: PlanField; row?: HTMLElement; path?: string;
    listen?: (node: EventTarget, kind: string, callback: (event: FocusEvent)=>void)=>void;
    onChange?: (field: PlanField)=>void; onFocusStateChange?: (state: PlanFocusState)=>void; nativeOnly?: boolean;
}
export interface PlanFieldState {path: string; value: number|string|boolean|null|undefined; text: string|undefined; focused: boolean; correcting: boolean; invalid: boolean;
    includeUnit: boolean; fractionDigits?: number; reportRangeError?: (value: number|string|boolean|null|undefined)=>void; dispose?: ()=>void;}
export interface DynamicFlexBindingOptions {doc?: Document; root?: HTMLElement; host?: HTMLElement; details?: HTMLElement;
    read?: ()=>D.PlanValues; disabled?: ()=>boolean; onChange?: (patch: Partial<D.PlanValues>)=>void;
    hasDetailErrors?: ()=>boolean; hasDetailCorrections?: ()=>boolean;}
export interface ReloadOptions {opener?: EventTarget; ready?: ()=>unknown; mutate?: (operation: Pick<I.Operation,'check'|'commit'>)=>unknown;
    flush?: ()=>unknown; reload?: ()=>unknown; subscribeChanges?: (notify: ()=>void)=>(()=>void); returnResult?: boolean;
    completionMessage?: string; finalizeDocument?: boolean;}
export interface ReloadResult {status: string; error?: import('./runtime-contracts.js').AppError;}
