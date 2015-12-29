(function() {
    // extension.js fires a runtime.connect() signal, background.js catches
    // this onConnect event and store the port object into ports[tabId].
    // c.f. https://developer.chrome.com/extensions/runtime
    var ports = {};

    // tabIds stores keys of ports.
    var tabIds = [];

    // After the front-end (a tab) is initialized, extension.js will fire a
    // connection.

    function InitFrontEnd(tab_info) {
        // tab_info = {
        //     id: tabId,
        //     url: str,
        //     title: str,
        //     etc.
        // }

        // Only capture HTTP or HTTPs tabs, one normal tab can has only one
        // sniffing tab.
        if (!/(?:http|https):.*/.exec(tab_info.url) || ports[tab_info.id]) {
            // There is no API to focus on a tab.
            return;
        } else {
            chrome.tabs.create({
                // URL to the frontend interface
                'url': chrome.extension.getURL('blank.html?tabId=' + tab_info.id)
            });
        }
    }

    chrome.browserAction.onClicked.addListener(InitFrontEnd);

    // connectToFrontEnd & disconnectFromFrontEnd handle connection between
    // background.js & extension.js

    function connectToFrontEnd(port) {
        // port.name is the tabId to sniff (in string)
        var id = parseInt(port.name);

        if (tabIds.length == 0) {
            webRequestListenerOn();
        }

        if (ports[id]) {
            port.postMessage({
                type: 'extensionError',
                detail: 'Tab ' + id + ' is sniffed somewhere else.'
            });
        } else {
            ports[id] = port;
            tabIds.push(id);
            port.onDisconnect.addListener(disconnectFromFrontEnd)
            setIcon();
        }
    }

    function disconnectFromFrontEnd(port) {
        var disconnect_id = parseInt(port.name);

        tabIds = tabIds.filter(function(id) { return id != disconnect_id; });
        delete ports[disconnect_id];
        setIcon();

        if (tabIds.length == 0) {
            webRequestListenerOff();
        }
    }

    chrome.runtime.onConnect.addListener(connectToFrontEnd);

    function setIcon() {
        if (tabIds.length < 5) {
            var icon = 'pig_nose_16_' + tabIds.length.toString() + '.png';
        } else {
            var icon = 'pig_nose_16_+.png';
        }

        chrome.browserAction.setIcon({
            'path': chrome.extension.getURL(icon)
        });
    }

    // Basic idea is to hook some functions onto chrome.webRequest's events,
    // let these functions fire port.postMessage() so extension.js will
    // receive related informations.

    function packRequestDetails(type, req_details) {
        var port = ports[req_details.tabId];

        if (port) {
            port.postMessage({
                type: type,
                req_details: req_details
            });
        }
    }

    function beforeSendHeaders(req_details) {
        packRequestDetails('waiting', req_details);
    }

    function headersReceived(req_details) {
        packRequestDetails('transfering', req_details);
    }

    function completed(req_details) {
        packRequestDetails('completed', req_details);
    }

    // Filter used for chrome.webRequest's events. Allow everythings.
    var url_filter_obj = {
        'urls': ['*://*/*']
    };

    function webRequestListenerOn() {
        chrome.webRequest.onBeforeSendHeaders.addListener(beforeSendHeaders, url_filter_obj, ["requestHeaders"]);
        chrome.webRequest.onHeadersReceived.addListener(headersReceived, url_filter_obj, ["responseHeaders"]);
        chrome.webRequest.onCompleted.addListener(completed, url_filter_obj);
    }

    function webRequestListenerOff() {
        chrome.webRequest.onBeforeSendHeaders.removeListener(beforeSendHeaders);
        chrome.webRequest.onHeadersReceived.removeListener(headersReceived);
        chrome.webRequest.onCompleted.removeListener(completed);
    }

    setIcon();
})();
