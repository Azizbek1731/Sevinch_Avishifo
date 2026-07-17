'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCallNext, useRooms } from '../hooks';

const NO_ROOM = 'none';

export interface CallNextButtonProps {
  queueId: string;
  disabled: boolean;
}

export function CallNextButton({ queueId, disabled }: CallNextButtonProps) {
  const t = useTranslations('queue');
  const [open, setOpen] = React.useState(false);
  const [roomId, setRoomId] = React.useState<string>(NO_ROOM);
  const rooms = useRooms(open);
  const callNext = useCallNext();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="w-full" disabled={disabled}>
          <PhoneCall className="mr-2 h-4 w-4" />
          {t('callNext')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <p className="text-sm font-medium">{t('room')}</p>
        {rooms.isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROOM}>{t('noRoom')}</SelectItem>
              {(rooms.data ?? [])
                .filter((r) => r.isActive)
                .map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {room.name ? `${room.number} — ${room.name}` : room.number}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={callNext.isPending}
          onClick={() =>
            callNext.mutate(
              { queueId, roomId: roomId === NO_ROOM ? undefined : roomId },
              { onSuccess: () => setOpen(false) },
            )
          }
        >
          {t('call')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
