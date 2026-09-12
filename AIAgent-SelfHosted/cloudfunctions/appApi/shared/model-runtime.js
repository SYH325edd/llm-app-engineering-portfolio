'use strict';

function getModelRuntimeStage(strategy, stage) {
  return (
    strategy?.modelRuntime?.stages?.[stage] ??
    strategy?.modelRuntime?.[stage] ??
    null
  );
}

module.exports = { getModelRuntimeStage };
