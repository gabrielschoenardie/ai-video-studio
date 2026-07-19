import React from 'react';
import {Composition} from 'remotion';
import {AutoKillReel} from './scenes/AutoKillReel';
import {NeuralIntro} from './scenes/NeuralIntro';

export const Root: React.FC = () => (
  <>
    <Composition
      id="AutoKillReel"
      component={AutoKillReel}
      durationInFrames={600}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="NeuralIntro"
      component={NeuralIntro}
      durationInFrames={240}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
