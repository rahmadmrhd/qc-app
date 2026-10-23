// RANGKA SEMENTARA (Task 3): isi diimplementasikan di Task 4-5. Nama dan tanda tangan sudah final
// agar `routes.ts` dan typecheck gas/ bersih.
import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import type {
  AddCommentInput,
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverRefInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/rpc';
import type { HandoverRecord } from './repo';

function notImplemented_(): never {
  throw appError_('INTERNAL', 'belum diimplementasi');
}

export function toHandoverDto_(
  _handover: HandoverRecord,
  _customerNames: ReadonlyMap<string, string>,
): HandoverDto {
  return notImplemented_();
}

/** Seluruh task di lokasi yang diizinkan (satu RPC untuk kanban). */
export function handoverBoard_(_locationIds: readonly string[]): HandoverDto[] {
  return notImplemented_();
}

export function getHandoverDto_(
  _input: GetHandoverInput,
  _locationIds: readonly string[],
): HandoverDto {
  return notImplemented_();
}

export function handoverOptions_(): HandoverOptionsDto {
  return notImplemented_();
}

export function saveHandover_(_input: SaveHandoverInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function saveHandoverBatch_(
  _input: SaveHandoverBatchInput,
  _actor: ActorRef,
): HandoverDto[] {
  return notImplemented_();
}

export function setCheck_(_input: SetCheckInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function setDone_(_input: SetDoneInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function addComment_(_input: AddCommentInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}

export function cancelHandover_(_input: HandoverRefInput, _actor: ActorRef): HandoverDto {
  return notImplemented_();
}
