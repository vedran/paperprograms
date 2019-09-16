import React from 'react';
import ReactDOM from 'react-dom';

import ProjectorMain from './ProjectorMain';
import { paperSizes } from '../constants';

const element = document.createElement('div');
document.body.appendChild(element);
function render(callback) {
  const paperProgramsConfig = JSON.parse(localStorage.paperProgramsConfig);
  const paperSizeName = paperProgramsConfig.paperSize;
  const paperSize = paperSizeName in paperSizes ? paperSizes[paperSizeName] : paperSizes.LETTER;
  const paperRatio = paperSize[1] / paperSize[0];

  ReactDOM.render(
    <ProjectorMain
      knobPoints={paperProgramsConfig.knobPoints}
      paperRatio={paperRatio}
      pages={JSON.parse(localStorage.pages || '[]')}
      programs={JSON.parse(localStorage.programs || '[]')}
      markers={JSON.parse(localStorage.paperProgramsMarkers || '[]')}
      dataByPageNumber={JSON.parse(localStorage.dataByPageNumber || '{}')}
      onDataByPageNumberChange={(dataByPageNumber, otherCallback) => {
        localStorage.dataByPageNumber = JSON.stringify(dataByPageNumber);
        render(otherCallback);
      }}
    />,
    element,
    callback
  );
}
window.addEventListener('storage', () => render());
window.addEventListener('resize', () => render());
render();
