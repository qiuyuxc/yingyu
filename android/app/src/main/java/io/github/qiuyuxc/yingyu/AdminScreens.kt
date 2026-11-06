package io.github.qiuyuxc.yingyu

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.yukonga.miuix.kmp.basic.Text

@Composable fun AdminScreen(vm: MainViewModel) {
    val data = resource(vm, "/api/admin/overview")
    Page(vm, "管理工作台", "处理图片与扩容申请。", actions = {
        IconAction("refresh", "刷新数据") { vm.refresh() }
    }) {
        ResourceState(data, vm) { result ->
            GlassCard(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Hint("全站图片")
                        Text("${result.getInt("images")} 张", fontSize = AppType.stat, lineHeight = 24.sp)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Hint("待审核申请")
                        Text("${result.getInt("pendingRequests")} 条", fontSize = AppType.stat, lineHeight = 24.sp)
                    }
                }
                Divider()
                Hint("${result.getInt("users")} 位用户 · 已用 ${bytes(result.getLong("usedBytes"))} · 今日上传 ${result.getInt("uploadsToday")} 张")
            }
        }
        GlassCard(Modifier.fillMaxWidth(), padding = PaddingValues(8.dp), spacing = 0.dp) {
            SettingsRow("images", "全站图片管理", "查看图片与删除不合适的内容") { vm.navigate("admin-images") }
            Divider(Modifier.padding(horizontal = 8.dp))
            SettingsRow("space", "扩容申请审核", "批准或退回用户的扩容申请") { vm.navigate("admin-quota") }
        }
        Hint("存储、邮件和站点配置可在网页管理后台中调整。")
    }
}

@Composable fun QuotaScreen(vm: MainViewModel, admin: Boolean = false) {
    var status by remember { mutableStateOf("pending") }
    val data = resource(vm, if (admin) "/api/admin/quota-requests?status=$status" else "/api/quota/requests")
    val requests = data.data?.optJSONArray("requests")?.mapObjects(QuotaRequest::from).orEmpty()
    val pending = if (admin) null else requests.firstOrNull { it.status == "pending" }
    var amount by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var reviewing by remember { mutableStateOf<QuotaRequest?>(null) }
    var decision by remember { mutableStateOf("approved") }
    var grant by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    Page(vm, if (admin) "扩容审核" else "空间与配额", if (admin) "查看最近 100 条申请" else "免费申请，按需扩容。", actions = {
        IconAction("refresh", "刷新申请") { vm.revision++ }
    }) {
        if (!admin) LocalSession.current?.user?.let { user -> GlassCard(Modifier.fillMaxWidth()) {
            Text(bytes(user.quota), fontSize = AppType.stat, lineHeight = 24.sp)
            Hint("已用 ${bytes(user.used)} · 可用 ${bytes(user.quota - user.used - user.reserved)}")
            AppProgress(if (user.quota > 0) (user.used + user.reserved).toFloat() / user.quota else 1f)
        } }
        if (admin) Choices(listOf("pending" to "待审核", "approved" to "已通过", "rejected" to "已退回", "all" to "全部"), status, { status = it })
        else if (pending != null) GlassCard(Modifier.fillMaxWidth()) {
            Text("扩容申请正在审核", fontSize = AppType.section, lineHeight = 19.sp)
            Hint("申请总配额 ${bytes(pending.requested)}，审核结果会保留在下方记录中。")
        } else GlassCard(Modifier.fillMaxWidth()) {
            Hint("当前总配额 ${bytes(LocalSession.current?.user?.quota ?: 0)}")
            Field("希望获得的总配额（GB）", amount, { amount = it }, number = true)
            Field("用途说明 · 至少 5 个字符", reason, { reason = it.take(500) }, multiline = true)
            Action("提交申请", primary = true, enabled = !vm.working && !data.loading && data.error == null && reason.trim().length >= 5 && amount.isNotBlank()) { vm.work("申请已提交") {
                vm.api.request("/api/quota/requests", "POST", jsonOf("requestedBytes" to quotaBytes(amount), "reason" to reason)); reason = ""; amount = ""
            } }
        }
        ResourceState(data, vm) { result ->
            val entries = result.getJSONArray("requests").mapObjects(QuotaRequest::from)
            if (entries.isEmpty()) GlassCard(Modifier.fillMaxWidth()) { Text("暂无${if (admin) "待处理的" else "扩容"}申请"); Hint("新的申请会显示在这里。") }
            entries.forEach { item -> GlassCard(Modifier.fillMaxWidth()) {
                Text(if (admin) item.userName else "申请 ${bytes(item.requested)}", fontSize = AppType.section, lineHeight = 19.sp)
                Hint("当前 ${bytes(item.current)} → 申请总配额 ${bytes(item.requested)}")
                Text(item.reason, fontSize = AppType.body, lineHeight = AppType.bodyLine)
                Hint(when (item.status) { "approved" -> "已通过"; "rejected" -> "已退回"; else -> "等待审核" })
                if (item.note.isNotBlank()) Hint("审核说明：${item.note}")
                if (admin && item.status == "pending") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Action("批准", primary = true) { reviewing = item; decision = "approved"; grant = (maxOf(item.current, item.requested).toBigDecimal() / (1024L * 1024 * 1024).toBigDecimal()).stripTrailingZeros().toPlainString(); note = "" }
                    Action("退回") { reviewing = item; decision = "rejected"; note = "" }
                }
            } }
        }
    }
    reviewing?.let { item -> FormDialog(if (decision == "approved") "批准 ${item.userName} 的申请" else "退回 ${item.userName} 的申请", { if (!vm.working) reviewing = null }) {
        Hint("申请用途：${item.reason}")
        if (decision == "approved") Field("批准后的总配额（GB）", grant, { grant = it }, number = true)
        Field("审核说明", note, { note = it.take(500) }, multiline = true)
        Action("确认${if (decision == "approved") "批准" else "退回"}", primary = true, enabled = !vm.working) { vm.work("审核已完成") {
            val body = jsonOf("status" to decision, "adminNote" to note)
            if (decision == "approved") body.put("quotaBytes", quotaBytes(grant))
            vm.api.request("/api/admin/quota-requests/${item.id}", "PATCH", body); reviewing = null
        } }
    } }
}

private fun quotaBytes(value: String): Long {
    val amount = value.trim().toBigDecimalOrNull() ?: error("请输入有效的配额数值")
    require(amount > java.math.BigDecimal.ZERO && amount <= 102400.toBigDecimal()) { "配额必须大于 0 且不超过 102400 GB" }
    return (amount * (1024L * 1024 * 1024).toBigDecimal()).toLong()
}
