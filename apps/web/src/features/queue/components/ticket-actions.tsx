'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRightLeft,
  Check,
  Flag,
  MoreVertical,
  Play,
  RotateCcw,
  SkipForward,
} from 'lucide-react';
import { TicketPriority, TicketStatus, type QueueTicketPayload } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useTicketAction } from '../hooks';

export interface TransferTarget {
  doctorUserId: string;
  doctorName: string;
}

export interface TicketActionsProps {
  ticket: QueueTicketPayload;
  canCall: boolean;
  canManage: boolean;
  /** Other open doctor queues of the branch (transfer destinations). */
  transferTargets: TransferTarget[];
}

export function TicketActions({ ticket, canCall, canManage, transferTargets }: TicketActionsProps) {
  const t = useTranslations('queue');
  const tCommon = useTranslations('common');
  const action = useTicketAction();
  const [skipOpen, setSkipOpen] = React.useState(false);

  const showStart = canCall && ticket.status === TicketStatus.CALLED;
  const showFinish =
    canCall && (ticket.status === TicketStatus.CALLED || ticket.status === TicketStatus.IN_ROOM);
  const showSkip =
    canCall && (ticket.status === TicketStatus.WAITING || ticket.status === TicketStatus.CALLED);
  const showRecall =
    canCall && (ticket.status === TicketStatus.CALLED || ticket.status === TicketStatus.SKIPPED);
  const showManage = canManage && ticket.status === TicketStatus.WAITING;
  const showTransfer = showManage && transferTargets.length > 0;

  const hasCallActions = showStart || showFinish || showSkip || showRecall;
  if (!hasCallActions && !showManage) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={action.isPending}
            aria-label={tCommon('actions')}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {showStart ? (
            <DropdownMenuItem
              onSelect={() => action.mutate({ action: 'start', ticketId: ticket.id })}
            >
              <Play className="mr-2 h-4 w-4" />
              {t('actions.start')}
            </DropdownMenuItem>
          ) : null}
          {showFinish ? (
            <DropdownMenuItem
              onSelect={() => action.mutate({ action: 'finish', ticketId: ticket.id })}
            >
              <Check className="mr-2 h-4 w-4" />
              {t('actions.finish')}
            </DropdownMenuItem>
          ) : null}
          {showRecall ? (
            <DropdownMenuItem
              onSelect={() => action.mutate({ action: 'recall', ticketId: ticket.id })}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('actions.recall')}
            </DropdownMenuItem>
          ) : null}
          {showSkip ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setSkipOpen(true)}
            >
              <SkipForward className="mr-2 h-4 w-4" />
              {t('actions.skip')}
            </DropdownMenuItem>
          ) : null}
          {hasCallActions && showManage ? <DropdownMenuSeparator /> : null}
          {showManage ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Flag className="mr-2 h-4 w-4" />
                {t('actions.setPriority')}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={ticket.priority}
                    onValueChange={(value) =>
                      action.mutate({
                        action: 'priority',
                        ticketId: ticket.id,
                        priority: value as TicketPriority,
                      })
                    }
                  >
                    {Object.values(TicketPriority).map((p) => (
                      <DropdownMenuRadioItem key={p} value={p}>
                        {t(`priority.${p}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ) : null}
          {showTransfer ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                {t('actions.transfer')}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                  {transferTargets.map((target) => (
                    <DropdownMenuItem
                      key={target.doctorUserId}
                      onSelect={() =>
                        action.mutate({
                          action: 'transfer',
                          ticketId: ticket.id,
                          targetDoctorUserId: target.doctorUserId,
                        })
                      }
                    >
                      {target.doctorName}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={skipOpen}
        onOpenChange={setSkipOpen}
        title={t('confirmSkip.title')}
        description={t('confirmSkip.description', { number: ticket.ticketNumber })}
        confirmLabel={t('actions.skip')}
        cancelLabel={tCommon('cancel')}
        destructive
        onConfirm={() => action.mutate({ action: 'skip', ticketId: ticket.id })}
      />
    </>
  );
}
