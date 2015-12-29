(function($) {
    // Tab with tabId is sniffed by this copy of extension
    var tabId;
    // title of watching tab
    var tabTitle;
    // There is no limit to captured requests, but there is limit on UI table
    // size (for refresh speed consideration).
    var rowMaximum = 1000

    // DOM
    var autoSelectBtn;
    var filterInput;
    var requestsTable;
    var detailsWrapper;

    // Set to false to stop message flushing into view (but do not stop
    // receiving) Message then can only be seen by correct filtering.
    var requestsTableFlushing = true;

    // filterQ(url) == true means that url matches filter
    // filterQ == null means there is no filter
    var filterQ = null;

    // negative id: -id was selected, now hidden
    // postive id: id is now selected
    // undefined: unkown state
    var selectedRequestId;

    // Flag to control automatically selecting single row
    var autoSelectSingleRow;

    // Columns information
    var columnProps = {
        // tabId: {title: 'tab'},
        requestId: {title: 'reqId'},
        type: {title: 'type'},
        url: {title: 'URL'},
        // method: {title: 'mt'},
        // statusCode: {title: 'st'}
        // ip: {title: 'IP'},
        // timeStamp: {title: 'timestamp'},
    }

    function init() {
        var str_id = /tabId=(\d+)/.exec(window.location)[1];
        tabId = parseInt(str_id);

        // Copy title and favicon from sniffed tab whenever it's updated.
        chrome.tabs.onUpdated.addListener(function(tab_id, info, tab) {
            if (tab_id == tabId /*&& tab.status == 'complete'*/) {
                tabTitle = tab.title;
                document.title = '🐽' + tabTitle;
                if (info.favIconUrl) 
                    $('#favicon').attr({ href: info.favIconUrl });
            }
        });

        // Layout
        autoSelectBtn = $('#auto_select');
        filterInput = $('#filter');
        requestsTable = $('#req_table');
        detailsWrapper = $('#details_wrapper');

        autoSelectBtn.click(autoSelectSingleRowToggle);
        autoSelectSingleRowOn();

        // chrome.storage.local.get is asynchronous
        chrome.storage.local.get('filter', function(data){
            filterInput.val(data['filter']);
            filterChanged();
        });
        filterInput.on('input', filterChanged);

        var table_header = $('#req_header_row tr');
        for (i in columnProps) {
            table_header.append('<th class=col_' + i + '>' + columnProps[i].title);
        }

        // Building a connection between extension.js and background.js:
        // extension.js fires a connection, background.js catches onConnect
        // event. Then background.js sends messages, extension.js catches
        // onMessage event.
        chrome.runtime.connect({name: str_id})
            .onMessage.addListener(sortBackendMessage);

        // Reload the caller tab, so frontend can capture from the beginning.
        chrome.tabs.executeScript(tabId, {code: 'window.location.reload();'});
    }

    // c.f. https://developer.chrome.com/extensions/webRequest#event-onBeforeSendHeaders
    // msg = {
    //     type: 'extensionError'|'beforeSendHeaders'|'headerReceived'|'completed',
    //     req_details: {
    //         method: 'GET'|etc.,
    //         requestId: int,
    //         tabId: int,
    //         timeStamp: float,
    //         type: 'image'|'script'|etc.,
    //         url: str,
    //         responseHeaders: [
    //             etc.
    //         ],
    //         requestHeaders: [
    //             {name: 'Accept', value: 'image/webp,*/*;q=0.8'},
    //             {name: 'User-Agent', value: str},
    //             etc.
    //         ]
    //     }
    // }

    function sortBackendMessage(msg) {
        if (msg.type == 'extensionError') {
            updateError(msg.detail);
        } else {
            updateRequestsData(msg.type, msg.req_details);
        }
    }

    function updateError(err_detail) {
        $('#error').html(err_detail);
    }

    // A list of cumulated request Id, not longer than recordsLimit.
    // requestIds = [ requestId, etc. ]
    var requestIds = []

    // requestsData = {
    //     requestId: {
    //         url: url of history[-1].url, for filtering 
    //         lastStatus : 'waiting'|'transfering'|'completed',
    //         row: a Jquery <tr> object,
    //         history : [ req_details, etc. ]
    //         etc.
    //     }
    //     etc.
    // }
    var requestsData = {}

    function updateRequestsData(type, req_details) {
        var req_id = req_details.requestId;

        // Create <tr> object
        var row = $('<tr>').attr({
            id: req_id,
            class: 'row_' + type
        });
        for (i in columnProps) {
            var cell = $('<td>' + req_details[i] + '</td>').attr({ class: 'col_' + i });
            row.append(cell);
        };

        // Put <tr> object into requestsData and requestIds properly
        var req_data = requestsData[req_id];
        if (!req_data) {
            req_data = requestsData[req_id] = {
                url: req_details.url,
                lastStauts: type,
                row: row,
                history: [req_details]
            };
            requestIds.push(req_id);

            // Get rid of the oldest request Id
            // if (requestIds.length > recordsLimit) {
            //     var last_req_id = requestIds.shift();
            //     requestsData[last_req_id].row.remove();
            //     delete requestsData[last_req_id];
            // }
        } else {
            req_data.url = req_details.url;
            req_data.lastStatus = type;
            // Remove row before re-insert it, otherwise it's duplicated.
            req_data.row.remove();
            req_data.row = row;
            req_data.history.push(req_details);
        }

        row.click(function(e) {
            autoSelectSingleRowOff();
            selectRequestIdRow(req_id);
        });

        if (requestsTableFlushing) prependRow(req_id);
        tryAutoSelectSingleRow();
        updateControlInfo();
    }

    function updateControlInfo() {
        $('#info').html(requestsTable.find('tr').length + ' / ' +
                requestIds.length + ' Requests');
    }

    function prependRow(req_id) {
        var req_data = requestsData[req_id];
        var his = req_data.history;
        var needPrepend;

        // Display <tr> object
        // Prefer to display long/important request results
        if ((filterQ == null && !(req_data.lastStatus == 'completed' &&
                        his[his.length-1].timeStamp -
                        his[his.length-2].timeStamp < 2000)) || (filterQ != null
                        && filterQ(req_data.url)))
        {
            req_data.row.prependTo(requestsTable);
            // Reselect req_id if it was/is being selected
            if (Math.abs(selectedRequestId) == req_id)
                selectRequestIdRow(req_id);
        } else {
            if (selectedRequestId == req_id)
                selectRequestIdRow(-req_id);
        }
    }

    // Negative req_id to hide req_id selection
    function selectRequestIdRow(req_id) {
        // selected   now
        //    -a      -a      removeClass(a) + updateDetails(-a) == detailsWrapper.empty()
        //    -a       a      removeClass(a) + addClass(a) +  updateDetails(a)
        //    -a      -b      <undefined behavior>
        //    -a       b      removeClass(a) + addClass(b) +  updateDetails(a)
        //     a      -a      removeClass(a) + updateDetails(-a) 
        //     a       a      removeClass(a) + addClass(a) + updateDetails(a)
        //     a      -b      <undefined behavior>
        //     a       b      removeClass(a) + addClass(b) + updateDetails(b)
        if (selectedRequestId)
            requestsData[Math.abs(selectedRequestId)].row.removeClass('row_highlighted');

        if (req_id > 0)
            requestsData[req_id].row.addClass('row_highlighted');

        updateDetails(req_id);
        selectedRequestId = req_id;
    }

    function autoSelectSingleRowToggle() {
        if (autoSelectSingleRow)
            autoSelectSingleRowOff();
        else
            autoSelectSingleRowOn();
    }

    function autoSelectSingleRowOn() {
        autoSelectSingleRow = true;
        tryAutoSelectSingleRow();
        autoSelectBtn.addClass('active_button');
        autoSelectBtn.removeClass('non_active_button');
    }

    function autoSelectSingleRowOff() {
        autoSelectSingleRow = false;
        autoSelectBtn.removeClass('active_button');
        autoSelectBtn.addClass('non_active_button');
    }

    // If there is a single row and there is no previously selected row,
    // automatically select that row
    function tryAutoSelectSingleRow() {
        if (autoSelectSingleRow) {
            var rows = requestsTable.find('tr');
            if (rows.length == 1) 
                selectRequestIdRow(rows.first().attr('id'));
        }
    }

    function updateDetails(req_id) {
        detailsWrapper.empty();

        // Use updateDetails(negative) to clear detailsWrapper
        if (req_id < 0) return;

        var req_data = requestsData[req_id];
        var detail_type; /* unused */

        req_data.history.forEach(function(req_details) {
            if (req_details['requestHeaders']) 
                prependRequestBlock(req_details);
            else if (req_details['responseHeaders']) 
                prependResponseBlock(req_details);
            else 
                prependCompletedBlock(req_details);
        });
    }

    function prependRequestBlock(req_details) {
        var req_block = $('<div class=req_details>').prependTo(detailsWrapper);
        var req_download_panel = $('<div class=req_download_panel>').prependTo(detailsWrapper);

        var url = req_details.url;

        // Construct partial aria2c command
        var aria2c_file = url + "\n";
        req_details['requestHeaders'].forEach(function(header) {
            aria2c_file += ' header=' + header.name + ': ' + header.value + "\n";
        });
        aria2c_file += ' out=';

        // Build DOM
        var input = $('<input></input>').attr({
            type: 'text',
            class: 'filename',
            value: guessFileName(tabTitle, url)
        });
        var open_btn = $('<a>Open</a>').attr({ class: 'button', href: url, target: '_blank' });
        var download_btn = $('<a>Download</a>').attr({ class: 'button' });
        var aria2c_btn = $('<a>Aria2c</a>').attr({ class: 'button' });

        input.on('input', function(e) {
            var fn = input.val();
            var aria2c_file_inline = 'data:text/plain;charset=utf-8,' +
                encodeURIComponent(aria2c_file + fn);

            download_btn.attr({
                href: url,
                download: fn
            });

            aria2c_btn.attr({
                href: aria2c_file_inline,
                download: fn + '.aria2c'
            });
        });
        input.trigger('input');

        req_download_panel
            .append(input)
            .append(open_btn)
            .append(download_btn)
            .append(aria2c_btn);

        req_block
            .append(req_details.url + '<br/><br/>');
        req_details['requestHeaders'].forEach(function(header) {
            req_block.append('<b>' + header.name + ':</b> ' + header.value + '<br/>');
        });
    }

    function guessFileName(title, url) {
        // Try to delete common part from title
        var fn1 = /(.*\S)\s*[-–|«<>:：].*/.exec(title);
        fn1 = fn1 ? fn1[1] : title;

        // Guess file name of url
        // If there is only one row, than only use its extension
        var ext;
        if (requestsTable.find('tr').length > 1) {
            ext = /[^?]*\/([^\/?]+)(\?|$)/.exec(url);
            ext = ext ? ' - ' + ext[1] : '';
        } else {
            ext = /[^?]*(\.[^\/?]+)(\?|$)/.exec(url); 
            ext = ext ? ext[1] : '';
        }

        return fn1 + ext;
    }

    function prependResponseBlock(req_details) { }

    function prependCompletedBlock(req_details) { }

    function filterChanged() {
        chrome.storage.local.set({
            filter: filterInput.val()
        });

        // filter machanism can be complicated, pre-compile it into a callable
        var token_list = filterInput.val().split(/\s+/)
            .filter(function(token){
                return token != '';
            });
        if (token_list.length == 0) {
            filterQ = null;
        } else {
            filterQ = function(url) {
                var matched = true;
                token_list.forEach(function(token) {
                    matched = url.indexOf(token) > -1 && matched;
                });
                return matched
            };
        }

        // Use .detach() to keep event handler of rows
        requestsTable.find('tr').detach(); 
        detailsWrapper.empty();

        requestIds.slice(-rowMaximum).forEach(function(req_id) {
            prependRow(req_id);
        });

        tryAutoSelectSingleRow();
        updateControlInfo();
    }

    init();
})($);
