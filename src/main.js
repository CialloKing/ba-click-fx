import './style.css';
import { BAClickFX } from './ba-spark.js';

// 固定版本示例供发布检查读取：npm install ba-click-fx@1.1.14
const effect = new BAClickFX(
  {
    inputFilter(event)
    {
      // 游戏中 Pointer over UGUI 时不会创建 FX_Touch；演示页信息卡等价于 UGUI。
      return !(event.target instanceof Element && event.target.closest('[data-fx-ui]'));
    },
  },
);

const trigger = document.getElementById('triggerEffect');

trigger.addEventListener('click', () =>
{
  effect.boom(effect.width / 2, effect.height / 2);
});

window.addEventListener('keydown', (event) =>
{
  if (event.code !== 'Space' || event.repeat)
  {
    return;
  }

  event.preventDefault();
  effect.boom(effect.width / 2, effect.height / 2);
});

window.addEventListener('beforeunload', () =>
{
  effect.destroy();
});

window.BAClickFXDemo = effect;
