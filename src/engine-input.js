// 内部职责边界；完整版与定制构建使用这些同一份方法。
import {
  TOUCH_ACTION_DIRECTIONS,
  TOUCH_DIRECTION_THRESHOLD,
  TOUCH_FILTER_CACHE_MS,
  TOUCH_INPUT_MATCH_TOLERANCE,
  clamp,
  createTouchActionPolicy,
  createTrailPoint,
  distance,
  invalidateTrailPoints,
  isCanvas,
  lerp,
  scaleTimeDelta,
} from './engine-shared.js';
import { BUILD_DOM } from './build-capabilities.js';

export class InputRuntime
{

  _attachDomPointerListeners()
  {
    if (!BUILD_DOM)
    {
      return false;
    }

    if (this.domPointerListenersAttached)
    {
      return;
    }

    if (!this.usesTouchInputFallback)
    {
      // 页面控件可能在目标阶段停止冒泡；输入采样必须先于宿主事件处理。
      window.addEventListener('pointerdown', this._onPointerDown,
        { capture: true });
      window.addEventListener('pointermove', this._onPointerMove,
        {
          capture: true,
          passive: true,
        });
      window.addEventListener('pointerup', this._onPointerUp,
        {
          capture: true,
        });
      window.addEventListener('pointercancel', this._onPointerCancel,
        {
          capture: true,
        });
    }
    this.domPointerListenersAttached = true;
    this._syncTouchActionListeners();
  }

  _attachTouchActionListeners()
  {
    if (this.touchActionListenersAttached)
    {
      return;
    }

    window.addEventListener('touchstart', this._onTouchStart,
      {
        capture: true,
        passive: false,
      });
    window.addEventListener('touchmove', this._onTouchMove,
      {
        // Canvas 不参与命中测试时，只有非 passive Touch Event 才能在
        // 浏览器接管滚动前兑现 touchAction 的禁止方向。
        capture: true,
        passive: false,
      });
    window.addEventListener('touchend', this._onTouchEnd,
      {
        capture: true,
        passive: true,
      });
    window.addEventListener('touchcancel', this._onTouchEnd,
      {
        capture: true,
        passive: true,
      });
    const hostInClosedShadowRoot = this._isHostInClosedShadowRoot();

    if (hostInClosedShadowRoot && !this.usesTouchInputFallback)
    {
      // Window 侧看不到 closed ShadowRoot 的内部 target；先在真实作用域
      // 内记录同一个 PointerEvent 的过滤决定，窗口监听随后复用。
      this.host.addEventListener(
        'pointerdown',
        this._onClosedShadowPointerDown,
        { capture: true },
      );
    }

    if (hostInClosedShadowRoot &&
      typeof this.host?.addEventListener === 'function')
    {
      // closed Shadow 外部看不到真实 Touch target；不论是否支持
      // PointerEvent，都必须在内部作用域完成方向仲裁和 fallback 转发。
      this.host.addEventListener('touchstart', this._onTouchStart,
        {
          capture: true,
          passive: false,
        });
      this.host.addEventListener('touchmove', this._onTouchMove,
        {
          capture: true,
          passive: false,
        });
      this.host.addEventListener('touchend', this._onTouchEnd,
        {
          capture: true,
          passive: true,
        });
      this.host.addEventListener('touchcancel', this._onTouchEnd,
        {
          capture: true,
          passive: true,
        });
      this.closedShadowTouchListenersAttached = true;
    }
    this.touchActionListenersAttached = true;
  }

  _detachTouchActionListeners()
  {
    if (!this.touchActionListenersAttached)
    {
      this.touchGestureStarts.clear();
      this.touchPointerFilterResults.length = 0;
      this.closedShadowPointerDecisions = new WeakMap();
      this.closedShadowTouchListenersAttached = false;
      return;
    }

    if (typeof window !== 'undefined')
    {
      window.removeEventListener('touchstart', this._onTouchStart, true);
      window.removeEventListener('touchmove', this._onTouchMove, true);
      window.removeEventListener('touchend', this._onTouchEnd, true);
      window.removeEventListener('touchcancel', this._onTouchEnd, true);
    }
    if (this.closedShadowTouchListenersAttached)
    {
      this.host?.removeEventListener?.('touchstart', this._onTouchStart, true);
      this.host?.removeEventListener?.('touchmove', this._onTouchMove, true);
      this.host?.removeEventListener?.('touchend', this._onTouchEnd, true);
      this.host?.removeEventListener?.('touchcancel', this._onTouchEnd, true);
      this.closedShadowTouchListenersAttached = false;
    }
    this.host?.removeEventListener?.(
      'pointerdown',
      this._onClosedShadowPointerDown,
      true,
    );
    this.touchGestureStarts.clear();
    this.touchPointerFilterResults.length = 0;
    this.closedShadowPointerDecisions = new WeakMap();
    this.touchActionListenersAttached = false;
  }

  _syncTouchActionListeners()
  {
    const shouldAttach = this.domPointerListenersAttached &&
      (
        this.usesTouchInputFallback ||
        createTouchActionPolicy(this.config.touchAction).requiresShim
      );

    if (shouldAttach)
    {
      this._attachTouchActionListeners();
    }
    else
    {
      this._detachTouchActionListeners();
    }
  }

  _detachDomPointerListeners()
  {
    if (!BUILD_DOM)
    {
      return false;
    }

    if (!this.domPointerListenersAttached)
    {
      return;
    }

    this._detachTouchActionListeners();
    if (typeof window !== 'undefined')
    {
      if (!this.usesTouchInputFallback)
      {
        window.removeEventListener('pointerdown', this._onPointerDown, true);
        window.removeEventListener('pointermove', this._onPointerMove, true);
      }
      window.removeEventListener('pointerup', this._onPointerUp, true);
      window.removeEventListener('pointercancel', this._onPointerCancel, true);
    }
    this.domPointerListenersAttached = false;
  }

  _touchTargetsMatch(event, left, right)
  {
    if (!left || !right || left === right)
    {
      return true;
    }

    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];

    return path.includes(left) && path.includes(right);
  }

  _touchInputsMatch(event, input, clientX, clientY, target)
  {
    const eventTargetsMatch = input.eventTarget && event.target &&
      input.eventTarget === event.target;

    return Math.abs(input.clientX - clientX) <= TOUCH_INPUT_MATCH_TOLERANCE &&
      Math.abs(input.clientY - clientY) <= TOUCH_INPUT_MATCH_TOLERANCE &&
      (
        eventTargetsMatch ||
        this._touchTargetsMatch(event, input.target, target)
      );
  }

  _rememberTouchPointerFilterResult(
    event,
    accepted,
    filterAccepted = accepted,
  )
  {
    this.touchPointerFilterResults.push(
      {
        accepted,
        clientX: event.clientX,
        clientY: event.clientY,
        createdAt: performance.now(),
        eventTarget: event.target,
        filterAccepted,
        target: event.target,
      },
    );

    if (this.touchPointerFilterResults.length > 8)
    {
      this.touchPointerFilterResults.shift();
    }
  }

  _consumeTouchPointerFilterResult(event, touch)
  {
    const now = performance.now();
    const target = touch.target ?? event.target;

    for (let index = this.touchPointerFilterResults.length - 1; index >= 0; index--)
    {
      const result = this.touchPointerFilterResults[index];

      if (now - result.createdAt > TOUCH_FILTER_CACHE_MS)
      {
        this.touchPointerFilterResults.splice(index, 1);
        continue;
      }

      if (!this._touchInputsMatch(
        event,
        result,
        touch.clientX,
        touch.clientY,
        target,
      ))
      {
        continue;
      }

      this.touchPointerFilterResults.splice(index, 1);
      return result;
    }

    return undefined;
  }

  _consumeTouchGestureState(event)
  {
    for (const state of this.touchGestureStarts.values())
    {
      if (
        state.pointerDecisionConsumed ||
        !this._touchInputsMatch(
          event,
          state,
          event.clientX,
          event.clientY,
          event.target,
        )
      )
      {
        continue;
      }

      state.pointerDecisionConsumed = true;
      return state;
    }

    return null;
  }

  _isTouchEventInScope(event, touchTarget = null)
  {
    if (!this.host)
    {
      return true;
    }

    const target = touchTarget ?? event.target;

    if (
      target === this.host ||
      (
        target &&
        typeof this.host.contains === 'function' &&
        this.host.contains(target)
      )
    )
    {
      return true;
    }

    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];

    return path.includes(this.host);
  }

  _isClosedShadowWindowTouchEvent(event)
  {
    if (!this._isHostInClosedShadowRoot())
    {
      return false;
    }

    // 真实 DOM 会提供 currentTarget；测试夹具的简化 EventTarget 不会，
    // 此时只有 scope 失败的 window 目标才应视作重定向事件。
    const isWindowDispatch = event.currentTarget === undefined ||
      event.currentTarget === (typeof window !== 'undefined' ? window : null);

    return isWindowDispatch &&
      !this._isTouchEventInScope(event, event.target);
  }

  _isHostInClosedShadowRoot()
  {
    let node = this.host;

    // Window 会跨过 open ShadowRoot，但任意外层 closed 边界都会隐藏真实
    // Pointer target，因此必须沿宿主链检查，而不只检查最近的一层。
    while (typeof node?.getRootNode === 'function')
    {
      const root = node.getRootNode();

      if (!root?.host)
      {
        return false;
      }

      if (root.mode === 'closed')
      {
        return true;
      }

      node = root.host;
    }

    return false;
  }

  _handleClosedShadowPointerDown(event)
  {
    if (
      this.destroyed ||
      this.paused ||
      event.pointerType !== 'touch'
    )
    {
      return;
    }

    const accepted = !this.inputFilter || this.inputFilter(event);

    this.closedShadowPointerDecisions.set(event, accepted);
    // Window capture 先于 closed Shadow 内部 target；在真实作用域内立即
    // 完成启动，随后不再依赖被重定向 target 的窗口冒泡阶段。
    this._handlePointerDown(event);
  }

  _createTouchPointerEvent(
    event,
    touch,
    type = 'pointermove',
    isPrimary = null,
  )
  {
    const target = touch.target ?? event.target;
    const activeTouches = event.touches ?? event.changedTouches;
    const primaryTouchIdentifier = activeTouches?.[0]?.identifier;
    const resolvedIsPrimary = isPrimary === null
      ? touch.identifier === primaryTouchIdentifier
      : isPrimary === true;
    const pageX = Number.isFinite(touch.pageX)
      ? touch.pageX
      : touch.clientX + (typeof window !== 'undefined' ? (window.pageXOffset || 0) : 0);
    const pageY = Number.isFinite(touch.pageY)
      ? touch.pageY
      : touch.clientY + (typeof window !== 'undefined' ? (window.pageYOffset || 0) : 0);

    return {
      type,
      target,
      currentTarget: event.currentTarget ?? (typeof window !== 'undefined' ? window : null),
      pointerId: touch.identifier,
      pointerType: 'touch',
      isPrimary: resolvedIsPrimary,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: touch.clientX,
      clientY: touch.clientY,
      pageX,
      pageY,
      screenX: touch.screenX ?? touch.clientX,
      screenY: touch.screenY ?? touch.clientY,
      width: touch.radiusX ? touch.radiusX * 2 : 1,
      height: touch.radiusY ? touch.radiusY * 2 : 1,
      pressure: Number.isFinite(touch.force) ? touch.force : 0.5,
      timeStamp: event.timeStamp,
      cancelable: event.cancelable ?? false,
      defaultPrevented: event.defaultPrevented ?? false,
      composedPath: typeof event.composedPath === 'function'
        ? event.composedPath.bind(event)
        : () => [],
      preventDefault: () => event.preventDefault?.(),
      stopPropagation: () => event.stopPropagation?.(),
      stopImmediatePropagation: () => event.stopImmediatePropagation?.(),
    };
  }

  _acceptTouchStart(event, touch, isPrimary = null)
  {
    const target = touch.target ?? event.target;
    const pointerFilterResult = this._consumeTouchPointerFilterResult(
      event,
      touch,
    );

    if (!this._isTouchEventInScope(event, target))
    {
      return {
        accepted: false,
        filterAccepted: false,
        isPrimary,
        pointerDecisionConsumed: false,
        pointerFilterPending: false,
        target,
      };
    }

    if (pointerFilterResult !== undefined)
    {
      const accepted = pointerFilterResult.accepted;
      const filterAccepted = pointerFilterResult.filterAccepted ?? accepted;

      return {
        accepted,
        filterAccepted,
        isPrimary,
        pointerDecisionConsumed: true,
        pointerFilterPending: false,
        target,
      };
    }

    if (this.usesTouchInputFallback && this.inputFilter)
    {
      // Touch-only 宿主没有后续 PointerEvent 可回填过滤结果；使用同一组
      // 坐标和 target 构造 pointer-like 事件，保持 inputFilter 合同。
      const accepted = this.inputFilter(
        this._createTouchPointerEvent(
          event,
          touch,
          'pointerdown',
          isPrimary,
        ),
      );

      return {
        accepted,
        filterAccepted: accepted,
        isPrimary,
        pointerDecisionConsumed: true,
        pointerFilterPending: false,
        target,
      };
    }

    if (!this.inputFilter)
    {
      return {
        accepted: true,
        filterAccepted: true,
        isPrimary,
        pointerDecisionConsumed: false,
        pointerFilterPending: false,
        target,
      };
    }

    // Pointer 与 Touch 的先后顺序因浏览器而异。Touch 先到时暂不伪造
    // PointerEvent；由随后的真实 pointerdown 完成过滤并回填本次手势。
    return {
      accepted: false,
      filterAccepted: false,
      isPrimary,
      pointerDecisionConsumed: false,
      pointerFilterPending: true,
      target,
    };
  }

  _handleTouchStart(event)
  {
    if (
      this.destroyed ||
      this.paused
    )
    {
      return;
    }

    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    const policy = createTouchActionPolicy(this.config.touchAction);
    const activeTouches = event.touches ?? touches;
    const primaryTouchIdentifier = activeTouches?.[0]?.identifier;

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      const touch = touches[index];
      const isPrimary = touch.identifier === primaryTouchIdentifier;
      const acceptance = this._acceptTouchStart(event, touch, isPrimary);

      this.touchGestureStarts.set(
        touch.identifier,
        {
          ...acceptance,
          clientX: touch.clientX,
          clientY: touch.clientY,
          eventTarget: event.target,
          filterAccepted: acceptance.filterAccepted ?? acceptance.accepted,
          isPrimary,
          policy,
          preventDefault: null,
          x: touch.clientX,
          y: touch.clientY,
        },
      );

      if (this.usesTouchInputFallback && acceptance.filterAccepted)
      {
        const started = this._startDomPointer(
          this._createTouchPointerEvent(
            event,
            touch,
            'pointerdown',
            isPrimary,
          ),
        );
        const state = this.touchGestureStarts.get(touch.identifier);

        // 单活动指针限制可能拒绝第二根手指；Touch 仲裁必须跟随实际
        // pointerDown 结果，否则会错误阻止宿主的多指手势。
        if (state)
        {
          state.accepted = started;
          state.pointerFilterPending = false;

          if (started)
          {
            this.fallbackTouchPointerId = touch.identifier;
          }
        }
      }
    }

    // none 已经在 touchstart 阶段确定不会让浏览器接管手势；提前阻止
    // 默认行为可避免部分移动浏览器在首个 touchmove 前抢先发送 pointercancel。
    if (policy.blockAll && event.cancelable)
    {
      const accepted = Array.from(this.touchGestureStarts.values())
        .some((state) => state.accepted);

      if (accepted)
      {
        event.preventDefault();
      }
    }
  }

  _getAcceptedTouchCount(event)
  {
    const touches = event.touches ?? event.changedTouches;
    let count = 0;

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      if (this.touchGestureStarts.get(touches[index].identifier)?.filterAccepted)
      {
        count++;
      }
    }

    return count;
  }

  _isTouchDirectionAllowed(policy, axis, delta)
  {
    if (axis === 'x')
    {
      if (!policy.allowX)
      {
        return false;
      }

      return policy.xDirections.has(
        delta < 0
          ? TOUCH_ACTION_DIRECTIONS.negative
          : TOUCH_ACTION_DIRECTIONS.positive,
      );
    }

    if (!policy.allowY)
    {
      return false;
    }

    return policy.yDirections.has(
      delta < 0
        ? TOUCH_ACTION_DIRECTIONS.negative
        : TOUCH_ACTION_DIRECTIONS.positive,
    );
  }

  _shouldPreventTouchMove(state, touch, acceptedTouchCount)
  {
    const policy = state.policy;

    if (policy.blockAll)
    {
      return true;
    }

    if (acceptedTouchCount > 1)
    {
      return !policy.allowPinch;
    }

    if (state.preventDefault !== null)
    {
      return state.preventDefault;
    }

    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);

    if (Math.max(absoluteX, absoluteY) < TOUCH_DIRECTION_THRESHOLD)
    {
      return false;
    }

    if (!policy.allowX && !policy.allowY)
    {
      state.preventDefault = true;
      return true;
    }

    if (absoluteX === absoluteY)
    {
      return false;
    }

    const axis = absoluteX > absoluteY ? 'x' : 'y';
    const delta = axis === 'x' ? deltaX : deltaY;

    // 与 CSS touch-action 一样，首次可判定方向后锁定本次手势；后续
    // 折返不能重新开启浏览器滚动并触发迟到的 pointercancel。
    state.preventDefault = !this._isTouchDirectionAllowed(
      policy,
      axis,
      delta,
    );
    return state.preventDefault;
  }

  _handleTouchMove(event)
  {
    if (this.destroyed || this.paused)
    {
      return;
    }

    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    let shouldPreventDefault = false;

    if (event.cancelable)
    {
      const acceptedTouchCount = this._getAcceptedTouchCount(event);

      for (let index = 0; index < (touches?.length ?? 0); index++)
      {
        const touch = touches[index];
        const start = this.touchGestureStarts.get(touch.identifier);

        if (!start?.accepted)
        {
          continue;
        }

        shouldPreventDefault = this._shouldPreventTouchMove(
          start,
          touch,
          acceptedTouchCount,
        );

        if (shouldPreventDefault)
        {
          break;
        }
      }
    }

    if (this.usesTouchInputFallback)
    {
      const sourceNow = performance.now();
      const trailNow = this._getTrailInputTime(sourceNow);
      const sampleSourceTime = this._getDomInputSourceTime(
        event.timeStamp,
        sourceNow,
      );
      const sampleTime = this._getDomTrailSampleTime(
        sampleSourceTime,
        sourceNow,
        trailNow,
      );

      for (let index = 0; index < (touches?.length ?? 0); index++)
      {
        const touch = touches[index];
        const state = this.touchGestureStarts.get(touch.identifier);

        if (!state?.accepted)
        {
          continue;
        }

        this._pointerMoveAtTime(
          this._getDomPointerInput(
            this._createTouchPointerEvent(
              event,
              touch,
              'pointermove',
              state.isPrimary,
            ),
          ),
          sampleTime,
          sampleSourceTime,
        );
      }
    }

    if (shouldPreventDefault && event.cancelable)
    {
      event.preventDefault();
    }
  }

  _handleTouchEnd(event)
  {
    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    const pointerType = event.type === 'touchcancel'
      ? 'pointercancel'
      : 'pointerup';

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      const touch = touches[index];
      const state = this.touchGestureStarts.get(touch.identifier);

      if (this.usesTouchInputFallback && state?.accepted)
      {
        const pointerEvent = this._createTouchPointerEvent(
          event,
          touch,
          pointerType,
          state.isPrimary,
        );

        if (pointerType === 'pointercancel')
        {
          this.pointerCancel(pointerEvent.pointerId);
        }
        else
        {
          this.pointerUp(pointerEvent.pointerId);
        }

        if (this.fallbackTouchPointerId === pointerEvent.pointerId)
        {
          this.fallbackTouchPointerId = null;
        }
      }

      this.touchGestureStarts.delete(touch.identifier);
    }

    if (event.touches?.length === 0)
    {
      const fallbackPointerId = this.fallbackTouchPointerId;

      if (
        this.usesTouchInputFallback &&
        fallbackPointerId !== null &&
        this.activePointerId === fallbackPointerId &&
        this.activePointerSource === 'press'
      )
      {
        if (pointerType === 'pointercancel')
        {
          this.pointerCancel(fallbackPointerId);
        }
        else
        {
          this.pointerUp(fallbackPointerId);
        }
      }

      this.fallbackTouchPointerId = null;

      this.touchGestureStarts.clear();
      this.touchPointerFilterResults.length = 0;
    }
  }

  _getCanvasRect()
  {
    if (this.host && !isCanvas(this.host) && typeof this.host.getBoundingClientRect === 'function')
    {
      return this.host.getBoundingClientRect();
    }

    if (typeof this.canvas?.getBoundingClientRect === 'function')
    {
      return this.canvas.getBoundingClientRect();
    }

    return {
      left: 0,
      top: 0,
      width: this.canvas?.width || 0,
      height: this.canvas?.height || 0,
    };
  }

  _getPointerPosition(event, rect = this._getCanvasRect())
  {
    return {
      x: clamp(event.clientX - rect.left, 0, this.width),
      y: clamp(event.clientY - rect.top, 0, this.height),
    };
  }

  _normalizePointerInput(input)
  {
    if (
      !input ||
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y) ||
      (input.pointerId !== undefined && !Number.isFinite(input.pointerId)) ||
      (
        input.pointerType !== undefined &&
        input.pointerType !== 'mouse' &&
        input.pointerType !== 'touch' &&
        input.pointerType !== 'pen'
      )
    )
    {
      return null;
    }

    return {
      x: clamp(input.x, 0, this.width),
      y: clamp(input.y, 0, this.height),
      pointerId: input.pointerId ?? 1,
      pointerType: input.pointerType ?? 'mouse',
    };
  }

  _getDomPointerInput(event, fallbackEvent = event, rect)
  {
    const position = this._getPointerPosition(event, rect);
    const pointerType = event.pointerType || fallbackEvent.pointerType || 'mouse';

    return {
      ...position,
      pointerId: event.pointerId ?? fallbackEvent.pointerId ?? 1,
      pointerType,
    };
  }

  _getDomInputSourceTime(timeStamp, sourceNow)
  {
    if (!Number.isFinite(timeStamp) || timeStamp <= 0)
    {
      return sourceNow;
    }

    let sampleSourceTime = timeStamp;

    if (
      sampleSourceTime > sourceNow + 1000 &&
      Number.isFinite(performance.timeOrigin)
    )
    {
      // 兼容仍以 Unix epoch 提供 Event.timeStamp 的旧宿主。
      sampleSourceTime -= performance.timeOrigin;
    }

    if (sampleSourceTime < 0 || sampleSourceTime > sourceNow + 1000)
    {
      return sourceNow;
    }

    // 未来时间戳对轨迹 bornAt 等价于当前时刻，但若直接作为限频锚点，
    // 会让后续真实样本长时间无法通过，因此统一钳到 sourceNow。
    return Math.min(sampleSourceTime, sourceNow);
  }

  _getDomTrailSampleTime(sampleSourceTime, sourceNow, trailNow)
  {
    const elapsedMs = Math.max(0, sourceNow - sampleSourceTime);

    return Math.max(
      0,
      trailNow - scaleTimeDelta(elapsedMs, this.config.trailTimeScale),
    );
  }

  _getTrailInputTime(now = performance.now())
  {
    this._advanceTrailTime(now);
    return this.trailTimeMs;
  }

  _getClickInputTime(now = performance.now())
  {
    this._advanceClickTime(now);
    return this.clickTimeMs;
  }

  _advanceClickTime(now = performance.now())
  {
    if (this.paused || !Number.isFinite(now))
    {
      return 0;
    }

    if (this.lastClickTimeSource === null)
    {
      this.lastClickTimeSource = now;
      return 0;
    }

    const elapsedMs = now - this.lastClickTimeSource;

    if (elapsedMs <= 0)
    {
      return 0;
    }

    const scaledDeltaMs = scaleTimeDelta(
      elapsedMs,
      this.config.clickTimeScale,
    );

    this.clickTimeMs += scaledDeltaMs;
    this.lastClickTimeSource = now;
    return scaledDeltaMs;
  }

  _advanceTrailTime(now = performance.now())
  {
    if (this.paused || !Number.isFinite(now))
    {
      return 0;
    }

    if (this.lastTrailTimeSource === null)
    {
      this.lastTrailTimeSource = now;
      return 0;
    }

    // RAF 空闲时真实时间仍要推进衰减；暂停则通过清空时间源显式冻结。
    // 测试或宿主提供的时间若短暂回退，保留原锚点避免下一次重复累计。
    const elapsedMs = now - this.lastTrailTimeSource;

    if (elapsedMs <= 0)
    {
      return 0;
    }

    const scaledDeltaMs = scaleTimeDelta(
      elapsedMs,
      this.config.trailTimeScale,
    );

    this.trailTimeMs += scaledDeltaMs;
    this.lastTrailTimeSource = now;
    return scaledDeltaMs;
  }

  _getPointerDownDecision(event)
  {
    const decision =
    {
      accepted: false,
      rememberTouchPointerFilterResult: false,
      touchState: null,
    };
    const pointerType = event.pointerType || 'mouse';
    const isTouchStart = pointerType === 'touch' &&
      event.type === 'pointerdown';
    const usesTouchShim = isTouchStart &&
      this.touchActionListenersAttached;
    const hasClosedShadowDecision = usesTouchShim &&
      this.closedShadowPointerDecisions.has(event);
    const closedShadowDecision = hasClosedShadowDecision
      ? this.closedShadowPointerDecisions.get(event)
      : undefined;
    const isClosedShadowRetarget = usesTouchShim &&
      this._isHostInClosedShadowRoot() &&
      !this._isTouchEventInScope(event, event.target);

    if (hasClosedShadowDecision)
    {
      this.closedShadowPointerDecisions.delete(event);
    }

    if (usesTouchShim)
    {
      // Touch-first 先在 window capture 看到 closed Shadow 的重定向宿主；
      // 保留 pending 状态，让内部 host capture 用真实 target 回填决定。
      const touchState = isClosedShadowRetarget
        ? null
        : this._consumeTouchGestureState(event);
      decision.touchState = touchState;

      if (touchState && !touchState.pointerFilterPending)
      {
        decision.accepted = touchState.accepted;
        return decision;
      }

      if (touchState)
      {
        decision.accepted = hasClosedShadowDecision
          ? closedShadowDecision
          : !this.inputFilter || this.inputFilter(event);

        touchState.accepted = decision.accepted;
        touchState.filterAccepted = decision.accepted;
        touchState.pointerFilterPending = false;
        return decision;
      }
    }

    if (hasClosedShadowDecision)
    {
      decision.accepted = closedShadowDecision;
      decision.rememberTouchPointerFilterResult = usesTouchShim;
      return decision;
    }

    // button: 0=左键, -1=未按键(移动事件)；仅 >0 的非左键实际点击需拦截
    if (pointerType === 'mouse' && event.button > 0)
    {
      return decision;
    }

    if (
      usesTouchShim &&
      !this._isTouchEventInScope(event, event.target)
    )
    {
      // closed Shadow 的真实 target 会在内部 capture 监听中完成决定；
      // Window capture 此时只负责让路，不能缓存一个伪造的拒绝结果。
      decision.rememberTouchPointerFilterResult =
        !this._isHostInClosedShadowRoot();
      return decision;
    }

    decision.accepted = !this.inputFilter || this.inputFilter(event);
    decision.rememberTouchPointerFilterResult = usesTouchShim;
    return decision;
  }

  _startDomPointer(event)
  {
    const accepted = this.pointerDown(this._getDomPointerInput(event));

    if (accepted && this.config.inputSamplingRate > 0)
    {
      this.lastInputSampleSourceTime = this._getDomInputSourceTime(
        event.timeStamp,
        performance.now(),
      );
    }

    return accepted;
  }

  _handlePointerDown(event)
  {
    if (this.destroyed || this.paused)
    {
      return;
    }

    const decision = this._getPointerDownDecision(event);

    if (!decision.accepted)
    {
      if (decision.touchState)
      {
        decision.touchState.accepted = false;
        decision.touchState.filterAccepted = false;
        decision.touchState.pointerFilterPending = false;
      }

      if (decision.rememberTouchPointerFilterResult)
      {
        this._rememberTouchPointerFilterResult(event, false, false);
      }

      return;
    }

    const started = this._startDomPointer(event);
    const accepted = started && decision.accepted;

    // 过滤器接受不代表实例一定能接管指针；例如已有另一根真实指针时，
    // 必须把实际启动结果回填，否则 Touch 仲裁会阻止一个并不存在的拖尾。
    if (decision.touchState)
    {
      decision.touchState.accepted = accepted;
      decision.touchState.filterAccepted = decision.accepted;
      decision.touchState.pointerFilterPending = false;
    }

    if (decision.rememberTouchPointerFilterResult)
    {
      this._rememberTouchPointerFilterResult(
        event,
        accepted,
        decision.accepted,
      );
    }
  }

  /**
   * 使用 Canvas 局部 CSS 像素开始一次点击和拖尾生命周期。
   * 手动输入由宿主完成按键和环境过滤，因此不会经过 inputFilter。
   */
  pointerDown(input)
  {
    if (this.destroyed || this.paused)
    {
      return false;
    }

    const pointer = this._normalizePointerInput(input);

    if (!pointer)
    {
      return false;
    }

    // 只有无按键的悬停轨迹允许被一次真实按下接管；真实按下之间仍保持单指针上限。
    if (
      this.activePointerId !== null &&
      this.activePointerSource !== 'hover'
    )
    {
      return false;
    }

    if (this.activePointerId !== null && this.currentTrailStroke)
    {
      // 点击接管悬停时只停止旧 stroke 发射，已有顶点仍自然衰减。
      this.currentTrailStroke.active = false;
    }

    this.activePointerId = pointer.pointerId;
    this.activePointerSource = 'press';
    this._beginTrailOwner();
    const inputSourceTime = performance.now();

    this.lastPointerPosition = { x: pointer.x, y: pointer.y };
    this.lastPointerTime = this._getTrailInputTime(inputSourceTime);
    this.lastInputSampleSourceTime = inputSourceTime;
    this.trailDistanceSinceShard = 0;

    if (this.config.trailEnabled)
    {
      this._startTrailStroke(this.lastPointerPosition, this.lastPointerTime);
    }

    if (this.config.clickEnabled)
    {
      this._spawnClick(pointer.x, pointer.y);
    }

    this._requestRender();
    return true;
  }

  _handlePointerMove(event)
  {
    if (
      this.destroyed || this.paused || !this.config.trailEnabled ||
      (this.activePointerId === null && !this.config.trailAlways)
    )
    {
      return;
    }

    if (
      this.activePointerId === null &&
      this.config.trailAlways &&
      !this._getPointerDownDecision(event).accepted
    )
    {
      return;
    }

    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];
    const events = coalesced.length > 0 ? coalesced : [event];
    const sourceNow = performance.now();
    const trailNow = this._getTrailInputTime(sourceNow);
    let rect;

    for (const sample of events)
    {
      const pointerId = sample.pointerId ?? event.pointerId ?? 1;
      const pointerType = sample.pointerType || event.pointerType || 'mouse';
      if (
        !Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY) ||
        !Number.isFinite(pointerId) ||
        (pointerType !== 'mouse' && pointerType !== 'touch' && pointerType !== 'pen') ||
        (this.activePointerId !== null && pointerId !== this.activePointerId)
      )
      {
        continue;
      }
      const sampleSourceTime = this._getDomInputSourceTime(
        sample.timeStamp ?? event.timeStamp,
        sourceNow,
      );
      if (
        this.activePointerId !== null &&
        !this._isInputSampleDue(sampleSourceTime)
      )
      {
        continue;
      }
      const sampleTime = this._getDomTrailSampleTime(
        sampleSourceTime,
        sourceNow,
        trailNow,
      );

      // 一次 DOM 事件的合并样本共享布局；跨事件重新测量以跟随滚动。
      rect ??= this._getCanvasRect();
      this._pointerMoveAtTime(
        this._getDomPointerInput(sample, event, rect),
        sampleTime,
        sampleSourceTime,
      );
    }
  }

  /** 追加一个手动指针采样点；采样 Hz 与空间阈值都不受时间倍率影响。 */
  pointerMove(input)
  {
    const inputSourceTime = performance.now();

    return this._pointerMoveAtTime(
      input,
      this._getTrailInputTime(inputSourceTime),
      inputSourceTime,
    );
  }

  _pointerMoveAtTime(input, sampleTime = null, sampleSourceTime = null)
  {
    if (this.destroyed || this.paused || !this.config.trailEnabled)
    {
      return false;
    }

    const pointer = this._normalizePointerInput(input);

    if (!pointer)
    {
      return false;
    }

    const position = { x: pointer.x, y: pointer.y };
    const requestedTime = Number.isFinite(sampleTime)
      ? sampleTime
      : this._getTrailInputTime();
    const inputSourceTime = Number.isFinite(sampleSourceTime)
      ? sampleSourceTime
      : performance.now();
    const now = Math.max(this.lastPointerTime, requestedTime);

    // trailAlways 的悬停轨迹没有按下事件；首个移动样本负责创建逻辑指针。
    if (this.activePointerId === null && this.config.trailAlways)
    {
      this.activePointerId = pointer.pointerId;
      this.activePointerSource = 'hover';
      this._beginTrailOwner();
      this.lastPointerPosition = position;
      this.lastPointerTime = now;
      this.lastInputSampleSourceTime = inputSourceTime;
      this.trailDistanceSinceShard = 0;
      this._startTrailStroke(position, now, true);
      this._requestRender();
      return true;
    }

    if (
      this.activePointerId === null ||
      pointer.pointerId !== this.activePointerId
    )
    {
      return false;
    }

    if (!this._acceptInputSample(inputSourceTime))
    {
      // 返回值表示逻辑指针已接受；限频样本与空间阈值 no-op 一样仍返回 true。
      return true;
    }

    this._ensureCurrentTrailStroke(now);
    this._appendPointerSample(position, now);

    this._requestRender();
    return true;
  }

  _isInputSampleDue(inputSourceTime)
  {
    const rate = this.config.inputSamplingRate;

    return rate <= 0 || !Number.isFinite(this.lastInputSampleSourceTime) ||
      inputSourceTime - this.lastInputSampleSourceTime >= 1000 / rate;
  }

  _acceptInputSample(inputSourceTime)
  {
    if (!this._isInputSampleDue(inputSourceTime))
    {
      return false;
    }

    if (this.config.inputSamplingRate > 0)
    {
      // 预检查不推进时钟；只有有效指针接受后才提交时间采样相位。
      // 即使空间位移不足 minVertexDistance，也保持现有的时间限频语义。
      this.lastInputSampleSourceTime = inputSourceTime;
    }
    return true;
  }

  _startTrailStroke(position, now, includeVisibleSeed = false)
  {
    const points = [createTrailPoint(position.x, position.y, now)];

    if (includeVisibleSeed)
    {
      // 向画布内部偏移可保证右下角也不会生成两个完全重合的伪顶点。
      const seedX = position.x < this.width
        ? position.x + 0.5
        : position.x - 0.5;

      points.push(createTrailPoint(seedX, position.y, now));
    }

    this.currentTrailStroke = {
      active: true,
      ownerId: this.activeTrailOwnerId,
      points,
      pointsVersion: 0,
    };
    this.trailStrokes.push(this.currentTrailStroke);
  }

  _beginTrailOwner()
  {
    const ownerId = this.nextTrailOwnerId;

    // 每次按下对应官方对象池中的一个 FX_Touch 实例，粒子上限不能跨实例共享。
    this.nextTrailOwnerId++;
    this.activeTrailOwnerId = ownerId;
    this.trailShardCounts.set(ownerId, 0);
  }

  _releaseTrailShardOwner(shard)
  {
    if (shard.kind !== 'trail' || !Number.isFinite(shard.ownerId))
    {
      return;
    }

    const nextCount = Math.max(
      0,
      (this.trailShardCounts.get(shard.ownerId) ?? 0) - 1,
    );

    if (nextCount === 0 && shard.ownerId !== this.activeTrailOwnerId)
    {
      this.trailShardCounts.delete(shard.ownerId);
      return;
    }

    this.trailShardCounts.set(shard.ownerId, nextCount);
  }

  _ensureCurrentTrailStroke(now)
  {
    if (!this.lastPointerPosition)
    {
      return;
    }

    if (!this.currentTrailStroke)
    {
      this._startTrailStroke(this.lastPointerPosition, now);
      this.lastPointerTime = now;
      this.trailDistanceSinceShard = 0;
    }
    else if (
      this.currentTrailStroke.points.length === 0 ||
      (
        this.currentTrailStroke.points.length === 1 &&
        now - this.currentTrailStroke.points[0].bornAt >=
          this.fxConfig.trail.lifetimeMs
      )
    )
    {
      // 空闲裁剪后的首个移动必须从当前时刻重新起算，不能跨空闲期插值。
      this.currentTrailStroke.points.length = 0;
      this.currentTrailStroke.points.push(createTrailPoint(
        this.lastPointerPosition.x,
        this.lastPointerPosition.y,
        now,
      ));
      invalidateTrailPoints(this.currentTrailStroke);
      this.lastPointerTime = now;
      this.trailDistanceSinceShard = 0;
    }
  }

  _appendPointerSample(position, now)
  {
    this._invalidateCanvasBoundsScope();
    if (!this.currentTrailStroke || !this.lastPointerPosition)
    {
      return;
    }

    const from = this.lastPointerPosition;
    const segmentLength = distance(from, position);
    const scale = this._getScale();
    const vertexDistance = Math.max(
      0.5,
      this.fxConfig.trail.minVertexDistance * scale,
    );

    if (segmentLength < vertexDistance)
    {
      return;
    }

    const count = Math.min(512, Math.floor(segmentLength / vertexDistance));
    const points = this.currentTrailStroke.points;
    const sampleStartTime = points.length === 1 ? now : this.lastPointerTime;
    if (points.length === 1)
    {
      // TrailRenderer 首次移动时同时创建起点和终点；只对齐轨迹出生时间，
      // 碎片仍沿原始输入时间段发射，不能让绘制采样改写粒子模拟。
      points[0].bornAt = now;
    }

    for (let index = 1; index <= count; index++)
    {
      const progress = index / count;
      const x = lerp(from.x, position.x, progress);
      const y = lerp(from.y, position.y, progress);
      const bornAt = lerp(sampleStartTime, now, progress);

      this.currentTrailStroke.points.push(createTrailPoint(x, y, bornAt));
    }
    invalidateTrailPoints(this.currentTrailStroke);

    this._spawnTrailShards(
      from,
      position,
      scale,
      this.lastPointerTime,
      now,
    );
    this.lastPointerPosition = position;
    this.lastPointerTime = now;
  }

  _handlePointerUp(event)
  {
    this.pointerUp(event.pointerId ?? 1);
  }

  _handlePointerCancel(event)
  {
    this.pointerCancel(event.pointerId ?? 1);
  }

  /** 结束指针；已有拖尾顶点继续自然消失。 */
  pointerUp(pointerId = 1)
  {
    if (
      this.destroyed ||
      this.paused ||
      !Number.isFinite(pointerId) ||
      this.activePointerId === null ||
      pointerId !== this.activePointerId
    )
    {
      return false;
    }

    this._releaseActivePointer(false);
    return true;
  }

  /** 强制结束异常指针状态，并立即移除当前轨迹。 */
  pointerCancel(pointerId = 1)
  {
    if (
      this.destroyed ||
      this.paused ||
      !Number.isFinite(pointerId) ||
      this.activePointerId === null ||
      pointerId !== this.activePointerId
    )
    {
      return false;
    }

    this._releaseActivePointer(true);
    return true;
  }

  _cancelPointer()
  {
    this.touchGestureStarts.clear();
    this.touchPointerFilterResults.length = 0;
    this.closedShadowPointerDecisions = new WeakMap();

    if (this.activePointerId !== null)
    {
      this._releaseActivePointer(true);
    }
  }

  _releaseActivePointer(discardCurrentStroke = false)
  {
    const releasedPointerId = this.activePointerId;
    const releasedOwnerId = this.activeTrailOwnerId;

    if (this.currentTrailStroke)
    {
      // 正常松开保留顶点自然衰减；异常取消必须丢弃当前 stroke。
      this.currentTrailStroke.active = false;

      if (discardCurrentStroke || this.currentTrailStroke.points.length < 2)
      {
        invalidateTrailPoints(this.currentTrailStroke);
        // 单点不能形成 TrailRenderer 几何，保留它只会让 RAF 空转。
        const strokeIndex = this.trailStrokes.indexOf(this.currentTrailStroke);

        if (strokeIndex >= 0)
        {
          this.trailStrokes.splice(strokeIndex, 1);
        }
      }
    }

    this.currentTrailStroke = null;
    this.activeTrailOwnerId = null;

    if (
      releasedOwnerId !== null &&
      (this.trailShardCounts.get(releasedOwnerId) ?? 0) === 0
    )
    {
      // 无存活粒子的 Unity 实例可以随指针一起释放，避免按点击次数积累空计数。
      this.trailShardCounts.delete(releasedOwnerId);
    }

    if (this.fallbackTouchPointerId === releasedPointerId)
    {
      this.fallbackTouchPointerId = null;
    }

    this.activePointerId = null;
    this.activePointerSource = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    this.lastInputSampleSourceTime = null;
    this.trailDistanceSinceShard = 0;
    this._requestRender();
  }
}
