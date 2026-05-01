import { ComponentType } from 'react';
import type { Session } from '@/lib/types';

// Silent Disco
import SilentDiscoClientView from './silent-disco/ClientView';
import SilentDiscoHostControls from './silent-disco/HostControls';

// Partners
import PartnersClientView from './partners/ClientView';
import PartnersHostControls from './partners/HostControls';

// Imposter
import ImposterClientView from './imposter/ClientView';
import ImposterHostControls from './imposter/HostControls';

// Freeze Dance
import FreezeDanceClientView from './freeze-dance/ClientView';
import FreezeDanceHostControls from './freeze-dance/HostControls';

export type ModeProps = {
  session: Session;
};

type ModeEntry = {
  label: string;
  ClientView: ComponentType<ModeProps>;
  HostControls: ComponentType<ModeProps>;
};

export const modes: Record<string, ModeEntry> = {
  silent_disco: {
    label: 'Silent Disco',
    ClientView: SilentDiscoClientView,
    HostControls: SilentDiscoHostControls,
  },
  partners: {
    label: 'Partners',
    ClientView: PartnersClientView,
    HostControls: PartnersHostControls,
  },
  imposter: {
    label: 'Imposter',
    ClientView: ImposterClientView,
    HostControls: ImposterHostControls,
  },
  freeze_dance: {
    label: 'Freeze Dance',
    ClientView: FreezeDanceClientView,
    HostControls: FreezeDanceHostControls,
  },
};
