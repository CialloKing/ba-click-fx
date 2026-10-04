#if UNITY_EDITOR
using System;
using System.Collections;
using UnityEngine;

// 仅编译进隔离的验证工程；Update / LateUpdate 不依赖批处理的 GameView 协程。
public sealed class BaCompareTicker : MonoBehaviour
{
    public Action Advance;
    public Action Capture;

    private void Update()
    {
        Advance?.Invoke();
    }

    private IEnumerator Start()
    {
        // TrailRenderer 在正常图形帧末更新几何与寿命，不能在 LateUpdate 提前烘焙。
        WaitForEndOfFrame frameEnd = new WaitForEndOfFrame();
        while (true)
        {
            yield return frameEnd;
            Capture?.Invoke();
        }
    }
}
#endif
