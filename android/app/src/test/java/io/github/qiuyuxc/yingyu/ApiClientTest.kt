package io.github.qiuyuxc.yingyu

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

private class MemorySessionStore(var value: ClientSession? = null) : SessionStore {
    override fun load() = value
    override fun save(session: ClientSession?) { value = session }
}

class ApiClientTest {
    private val user = User("test-user", "测试用户", "test@example.com", "user", 1024, 0, 0, 0, null)
    private fun state(server: MockWebServer, expires: Instant = Instant.now().plusSeconds(10 * 86400)) =
        ClientSession(server.url("/").toString().trimEnd('/'), "yy_app_test", expires.toString(), user)

    @Test fun serverAddressRejectsCredentialsPathsAndCleartext() {
        assertEquals("https://example.com", canonicalServer(" https://EXAMPLE.com/ "))
        for (url in listOf("http://example.com", "https://user:password@example.com", "https://example.com/app", "https://example.com?token=x", "https://example.com#x")) {
            assertThrows(IllegalArgumentException::class.java) { canonicalServer(url) }
        }
    }
    @Test fun localPreviewHttpIsExplicitAndLimitedToLocalAddresses() {
        for (host in listOf("127.0.0.1", "localhost", "[::1]", "192.168.2.7", "10.1.2.3", "172.16.0.1", "172.31.255.254")) {
            assertEquals("http://$host:8787", canonicalServer("http://$host:8787", allowLocalHttp = true))
            assertThrows(IllegalArgumentException::class.java) { canonicalServer("http://$host:8787") }
        }
        for (host in listOf("example.com", "192.168.2.7.example.com", "172.15.0.1", "172.32.0.1", "8.8.8.8", "192.169.0.1")) {
            assertThrows(IllegalArgumentException::class.java) { canonicalServer("http://$host:8787", allowLocalHttp = true) }
        }
        assertFalse(allowedConnection("http://192.168.2.7/i/private".toHttpUrl()))
        assertTrue(allowedConnection("http://192.168.2.7/i/private".toHttpUrl(), allowLocalHttp = true))
    }
    @Test fun requestsUseBearerWithoutCookiesAndRetainIdentity() = runBlocking {
        MockWebServer().use { server ->
            val store = MemorySessionStore(state(server)); val client = ApiClient(store)
            server.enqueue(MockResponse().setBody("{\"albums\":[]}"))
            client.request("/api/albums")
            val request = server.takeRequest()
            assertEquals("Bearer yy_app_test", request.getHeader("Authorization"))
            assertNull(request.getHeader("Cookie"))
            assertEquals(user, store.value!!.user)
        }
    }
    @Test fun renewalRotatesStoredTokenBeforeAuthenticatedRequest() = runBlocking {
        MockWebServer().use { server ->
            val store = MemorySessionStore(state(server, Instant.now().plusSeconds(300)))
            val client = ApiClient(store)
            server.enqueue(MockResponse().setBody(jsonOf("session" to jsonOf("accessToken" to "yy_app_next", "expiresAt" to Instant.now().plusSeconds(30 * 86400).toString()), "user" to user.json()).toString()))
            server.enqueue(MockResponse().setBody("{\"albums\":[]}"))
            client.request("/api/albums")
            assertEquals("/api/mobile/v1/auth/refresh", server.takeRequest().path)
            assertEquals("Bearer yy_app_next", server.takeRequest().getHeader("Authorization"))
            assertEquals("yy_app_next", store.value!!.token)
        }
    }
    @Test fun unauthorizedSessionIsRemovedFromPersistentStore() = runBlocking {
        MockWebServer().use { server ->
            val store = MemorySessionStore(state(server)); val client = ApiClient(store)
            server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":\"请先登录\"}"))
            try { client.request("/api/auth/me"); fail("Expected unauthorized") } catch (error: ApiException) { assertEquals(401, error.status) }
            assertNull(store.value); assertNull(client.session.value)
        }
    }
    @Test fun imageRedirectsNeverForwardCredentialsToAnotherOrigin() {
        MockWebServer().use { origin -> MockWebServer().use { cdn ->
            val client = ApiClient(MemorySessionStore(state(origin)))
            origin.enqueue(MockResponse().setResponseCode(302).setHeader("Location", cdn.url("/image.png")))
            cdn.enqueue(MockResponse().setBody("image"))
            client.imageHttp.newCall(Request.Builder().url(origin.url("/i/image")).build()).execute().use { assertEquals("image", it.body!!.string()) }
            assertEquals("Bearer yy_app_test", origin.takeRequest().getHeader("Authorization"))
            assertNull(cdn.takeRequest().getHeader("Authorization"))
        } }
    }
    @Test fun authRequestsDoNotFollowRedirects() = runBlocking {
        MockWebServer().use { server ->
            val client = ApiClient(MemorySessionStore())
            server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "https://example.invalid/collect").setBody("{}"))
            try { client.signIn(server.url("/").toString().trimEnd('/'), "login", jsonOf("password" to "secret")); fail("Expected redirect error") }
            catch (error: ApiException) { assertEquals(307, error.status) }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun imageLinksEscapeMarkup() {
        val image = HostedImage("id", "<image \"one\">", 1, "https://example.com/i/id", "public", false, null, "", null)
        assertEquals("<img src=\"https://example.com/i/id\" alt=\"&lt;image &quot;one&quot;&gt;\" />", image.link("HTML"))
    }
}
